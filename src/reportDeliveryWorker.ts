import { randomUUID, createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import amqp, { type ConfirmChannel, type ConsumeMessage } from 'amqplib'
import { env } from './config/env.js'
import { createDbPool } from './db/pool.js'
import { createLogger } from './logger.js'
import { PgReportDeliveryRepository } from './modules/reportDelivery/reportDeliveryRepository.js'
import { SmtpDeliveryError, SmtpReportMailer } from './modules/reportDelivery/smtpMailer.js'
import { ReportAssetStorage } from './modules/reports/reportAssetStorage.js'

const logger = createLogger(env.logLevel)
const workerId = 'report-delivery-' + randomUUID()
const exchange = 'cwi.report.delivery'
const dispatchQueue = 'cwi.report.delivery.dispatch'
const sendQueue = 'cwi.report.delivery.send'
const routingDispatch = 'dispatch'
const routingSend = 'send'
let stopping = false

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function messageJson(message: ConsumeMessage) {
  try {
    const value = JSON.parse(message.content.toString('utf8')) as { campaignId?: string; jobId?: string }
    return value
  } catch {
    return {}
  }
}

async function publishCampaign(channel: ConfirmChannel, campaignId: string) {
  channel.publish(exchange, routingDispatch, Buffer.from(JSON.stringify({ campaignId })), { contentType: 'application/json', deliveryMode: 2 })
  await channel.waitForConfirms()
}

async function publishJobs(channel: ConfirmChannel, repository: PgReportDeliveryRepository, campaignId: string) {
  const publishWorkerId = workerId + '-publisher'
  const ids = await repository.claimUnpublished(campaignId, 100, publishWorkerId, env.reportDeliveryLockMs)
  if (!ids.length) return
  try {
    for (const id of ids) channel.publish(exchange, routingSend, Buffer.from(JSON.stringify({ jobId: id })), { contentType: 'application/json', deliveryMode: 2 })
    await channel.waitForConfirms()
    await repository.markPublished(ids, publishWorkerId)
  } catch (error) {
    await repository.releasePublishLocks(ids, publishWorkerId)
    throw error
  }
}

async function dispatchCampaign(channel: ConfirmChannel, repository: PgReportDeliveryRepository, campaignId: string) {
  const claimed = await repository.claimCampaign(campaignId, env.reportDeliveryLockMs)
  if (!claimed) return
  let done = false
  while (!done && !stopping) {
    const result = await repository.dispatchBatch(campaignId, env.reportDeliveryBatchSize)
    done = result.done
    await publishJobs(channel, repository, campaignId)
  }
  await repository.refreshCampaign(campaignId)
}

async function downloadPdf(storage: ReportAssetStorage, path: string, expectedSha: string, outputPath: string) {
  const download = await storage.download(path)
  const hash = createHash('sha256')
  const digest = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(download.body as globalThis.ReadableStream<Uint8Array>), digest, createWriteStream(outputPath, { flags: 'w', mode: 0o600 }))
  if (hash.digest('hex') !== expectedSha) throw new Error('PDF checksum does not match the database snapshot.')
}

async function consumeDispatch(channel: ConfirmChannel, repository: PgReportDeliveryRepository, message: ConsumeMessage) {
  const { campaignId } = messageJson(message)
  if (!campaignId) return
  await dispatchCampaign(channel, repository, campaignId)
}

async function consumeSend(repository: PgReportDeliveryRepository, storage: ReportAssetStorage, mailer: SmtpReportMailer, message: ConsumeMessage) {
  const { jobId } = messageJson(message)
  if (!jobId) return
  const job = await repository.claimJob(jobId, workerId, env.reportDeliveryLockMs)
  if (!job) {
    logger.warn({ jobId }, 'Send message skipped because the email job is no longer claimable')
    return
  }
  const directory = await mkdtemp(join(tmpdir(), 'cwi-report-delivery-'))
  const pdfPath = join(directory, 'report.pdf')
  let smtpAccepted = false
  try {
    if (job.storageBucket !== env.reportDeliveryBucket) throw new Error('PDF storage bucket does not match the configured delivery bucket.')
    await downloadPdf(storage, job.storagePath, job.fileSha256, pdfPath)
    const fromDomain = env.mailFromAddress.split('@')[1] ?? 'ceo-workforce-index.com'
    const messageId = '<cwi-report-' + job.submissionId + '@' + fromDomain + '>'
    const providerMessageId = await mailer.send({ messageId, originalFileName: job.originalFileName, pdfPath, recipientEmail: job.recipientEmail, recipientName: job.recipientName })
    smtpAccepted = true
    const markedSent = await repository.markSent(job.id, job.leaseToken, providerMessageId)
    if (!markedSent) {
      logger.warn({ campaignId: job.campaignId, jobId: job.id }, 'SMTP accepted the report but the worker lease was already lost')
      return
    }
    await repository.refreshCampaign(job.campaignId)
    logger.info({ campaignId: job.campaignId, jobId: job.id, submissionId: job.submissionId }, 'Report email sent')
    await sleep(Math.ceil(1000 / env.mailSendRatePerSecond))
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Gửi email thất bại.'
    const deliveryUnknown = smtpAccepted || (error instanceof SmtpDeliveryError && error.outcome === 'unknown')
    const marked = deliveryUnknown
      ? await repository.markUnknown(job.id, job.leaseToken, 'delivery_ambiguous', messageText)
      : await repository.markFailed(job.id, job.leaseToken, job.attemptCount, error instanceof SmtpDeliveryError ? 'smtp_not_sent' : 'delivery_failed', messageText, env.reportDeliveryMaxAttempts)
    if (!marked) {
      logger.warn({ campaignId: job.campaignId, jobId: job.id }, 'Delivery result was already finalized by another worker')
      return
    }
    await repository.refreshCampaign(job.campaignId)
    logger.error({ error, jobId: job.id, attempt: job.attemptCount, deliveryUnknown }, 'Report email failed')
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

async function run() {
  if (!env.reportDeliveryEnabled) {
    logger.info('Report delivery worker is disabled by REPORT_DELIVERY_ENABLED.')
    while (!stopping) await sleep(60_000)
    return
  }

  const pool = createDbPool({
    connectionTimeoutMillis: env.dbConnectionTimeoutMs,
    databaseUrl: env.databaseUrl,
    idleTimeoutMillis: env.dbIdleTimeoutMs,
    max: Math.max(2, Math.min(env.dbPoolMax, 5)),
    ssl: env.dbSsl,
  })
  const repository = new PgReportDeliveryRepository(pool)
  const storage = new ReportAssetStorage({
    bucket: env.reportDeliveryBucket,
    serviceRoleKey: env.supabaseServiceRoleKey,
    storageUrl: env.supabaseStorageUrl,
    timeoutMs: env.reportStorageUploadTimeoutMs,
  })
  const mailer = new SmtpReportMailer({
    authMode: env.mailAuthMode,
    fromAddress: env.mailFromAddress,
    fromName: env.mailFromName,
    host: env.mailSmtpHost,
    connectionTimeoutMs: env.mailSmtpConnectionTimeoutMs,
    greetingTimeoutMs: env.mailSmtpGreetingTimeoutMs,
    maxConnections: env.mailSmtpMaxConnections,
    maxMessages: env.mailSmtpMaxMessages,
    m365ClientId: env.mailM365ClientId,
    m365ClientSecret: env.mailM365ClientSecret,
    m365Scope: env.mailM365Scope,
    m365TenantId: env.mailM365TenantId,
    password: env.mailSmtpPassword,
    port: env.mailSmtpPort,
    replyTo: env.mailReplyTo,
    requireTls: env.mailSmtpRequireTls,
    secure: env.mailSmtpSecure,
    tokenTimeoutMs: env.mailM365TokenTimeoutMs,
    user: env.mailSmtpUser,
    socketTimeoutMs: env.mailSmtpSocketTimeoutMs,
  })
  await mailer.verify()
  const connection = await amqp.connect(env.rabbitmqUrl)
  const channel = await connection.createConfirmChannel()
  const dispatchConsumer = await connection.createChannel()
  const sendConsumer = await connection.createChannel()
  await channel.assertExchange(exchange, 'direct', { durable: true })
  await channel.assertQueue(dispatchQueue, { durable: true })
  await channel.assertQueue(sendQueue, { durable: true })
  await channel.bindQueue(dispatchQueue, exchange, routingDispatch)
  await channel.bindQueue(sendQueue, exchange, routingSend)
  await dispatchConsumer.prefetch(1)
  await sendConsumer.prefetch(Math.max(1, env.reportDeliveryConcurrency * env.reportDeliveryPrefetch))

  await dispatchConsumer.consume(dispatchQueue, (message) => {
    if (!message) return
    void consumeDispatch(channel, repository, message)
      .then(() => dispatchConsumer.ack(message))
      .catch(async (error) => {
        const { campaignId } = messageJson(message)
        if (campaignId) await repository.releaseCampaignDispatch(campaignId).catch((releaseError) => logger.error({ error: releaseError, campaignId }, 'Dispatch lease release failed'))
        logger.error({ error, campaignId }, 'Dispatch message failed; requeueing')
        await sleep(env.reportDeliveryRequeueDelayMs)
        dispatchConsumer.nack(message, false, true)
      })
  })
  await sendConsumer.consume(sendQueue, (message) => {
    if (!message) return
    void consumeSend(repository, storage, mailer, message)
      .then(() => sendConsumer.ack(message))
      .catch(async (error) => {
        logger.error({ error }, 'Send message failed; requeueing')
        await sleep(env.reportDeliveryRequeueDelayMs)
        sendConsumer.nack(message, false, true)
      })
  })

  try {
    while (!stopping) {
      await repository.expireStaleCampaigns()
      const recoveredCampaigns = await repository.recoverStaleSendingJobs(env.reportDeliveryLockMs)
      for (const campaignId of recoveredCampaigns) await repository.refreshCampaign(campaignId)
      const campaigns = await repository.listActiveCampaigns(10)
      for (const campaignId of campaigns) {
        await publishCampaign(channel, campaignId)
        await publishJobs(channel, repository, campaignId)
        await repository.refreshCampaign(campaignId)
      }
      await sleep(env.reportWorkerLoopIntervalMs)
    }
  } finally {
    await dispatchConsumer.close().catch(() => undefined)
    await sendConsumer.close().catch(() => undefined)
    await channel.close().catch(() => undefined)
    await connection.close().catch(() => undefined)
    mailer.close()
    await pool.end()
  }
}

process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })
void run().catch((error) => {
  logger.error({ error }, 'Report delivery worker stopped unexpectedly')
  process.exitCode = 1
})
