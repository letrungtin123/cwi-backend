import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AuditActor } from '../../src/modules/audit/adminAuditLog.js'
import type { AdminUser } from '../../src/modules/auth/authTypes.js'
import { PgNewsRepository } from '../../src/modules/news/newsRepository.js'
import { newsPageMeta } from '../../src/modules/news/newsRoutes.js'
import { normalizeNewsCategoryInput, normalizeNewsPageSettingsInput, normalizeNewsPostInput } from '../../src/modules/news/newsValidation.js'
import { databaseReachable, openRollbackDb, type RollbackDb } from './rollbackDb.js'

// News ("Tin tức") against the real local schema. Every write is rolled back.

const reachable = await databaseReachable()

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    const { code, statusCode } = error as { code?: string; statusCode?: number }
    return `${statusCode} ${code}`
  }
  return 'resolved'
}

function doc(text: string, imageId?: string) {
  return {
    content: [
      { content: [{ text, type: 'text' }], type: 'paragraph' },
      ...(imageId ? [{ attrs: { alt: '', src: `/api/v1/public/news/images/${imageId}`, title: '' }, type: 'image' }] : []),
    ],
    type: 'doc',
  }
}

describe.skipIf(!reachable)('news on the local database (rolled back)', () => {
  let db: RollbackDb
  let news: PgNewsRepository
  let actor: AuditActor
  let categoryId: string
  let coverId: string

  function post(overrides: Record<string, unknown> = {}) {
    return normalizeNewsPostInput({
      author: { en: '', vi: '' },
      categoryId,
      content: { en: doc('Hello leaders'), vi: doc('Xin chào lãnh đạo') },
      coverAlt: { en: 'Cover', vi: 'Ảnh bìa' },
      coverImageId: coverId,
      excerpt: { en: 'Short intro', vi: 'Sapo ngắn' },
      isPinned: false,
      publishedAt: null,
      seoDescription: { en: '', vi: '' },
      seoTitle: { en: '', vi: '' },
      slug: '',
      source: { name: '', url: '' },
      status: 'published',
      tags: { en: ['Leadership'], vi: ['Lãnh đạo'] },
      title: { en: 'First news', vi: 'Tin thử nghiệm đầu tiên' },
      ...overrides,
    })
  }

  beforeEach(async () => {
    db = await openRollbackDb()
    news = new PgNewsRepository(db.pool)
    const adminRow = await db.pool.query<{ display_name: string | null; email: string; id: string; role: string }>(
      `SELECT id, email, display_name, role FROM public.cwi_admin_users ORDER BY created_at LIMIT 1`,
    )
    const user = adminRow.rows[0]
    if (!user) throw new Error('The local database needs at least one dashboard account for this test.')
    actor = { meta: { clientIpHash: null, userAgent: 'vitest' }, user: { displayName: user.display_name, email: user.email, id: user.id, role: user.role } as AdminUser }
    const category = await news.createCategory(normalizeNewsCategoryInput({ description: { en: '', vi: '' }, isVisible: true, name: { en: 'Test news', vi: 'Tin thử dbtest' }, sortOrder: 900 }), actor)
    categoryId = category.id
    coverId = (await news.registerImage({ contentType: 'image/webp', fileSize: 100, sha256: 'a'.repeat(64), storagePath: `news/dbtest/${Date.now()}-cover.webp` }, actor)).id
  })

  afterEach(async () => {
    await db.close()
  })

  it('creates a category with its link from the Vietnamese name and refuses to delete it while it has posts', async () => {
    const categories = await news.listCategories()
    expect(categories.find((category) => category.id === categoryId)?.slug).toBe('tin-thu-dbtest')
    await news.createPost(post(), actor)
    expect(await rejection(news.deleteCategory(categoryId, actor))).toBe('409 news_category_not_empty')
  })

  it('publishes only a complete post in both languages', async () => {
    expect(await rejection(news.createPost(post({ excerpt: { en: '', vi: 'Sapo' } }), actor))).toBe('422 news_post_incomplete')
    const draft = await news.createPost(post({ excerpt: { en: '', vi: 'Sapo' }, status: 'draft' }), actor)
    expect(draft.status).toBe('draft')
    expect(draft.publishedAt).toBeNull()
    expect(await news.publicPost(draft.slug)).toBeNull()
  })

  it('shows a published post publicly, hides scheduled posts and posts of a hidden category', async () => {
    const live = await news.createPost(post(), actor)
    const scheduled = await news.createPost(post({ publishedAt: new Date(Date.now() + 86_400_000).toISOString(), slug: 'tin-hen-gio-dbtest', title: { en: 'Later', vi: 'Tin hẹn giờ' } }), actor)
    const found = await news.publicPost(live.slug)
    expect(found && 'post' in found ? found.post.title.vi : null).toBe('Tin thử nghiệm đầu tiên')
    expect(await news.publicPost(scheduled.slug)).toBeNull()
    const home = await news.publicHome()
    const slugs = [...home.featured, ...home.categories.flatMap((block) => block.posts)].map((card) => card.slug)
    expect(slugs).toContain(live.slug)
    expect(slugs).not.toContain(scheduled.slug)
    expect((await news.publicTag('lanh-dao', 0, 9))?.posts.map((card) => card.slug)).toContain(live.slug)
    expect(await news.countView(live.slug)).toBe(true)
    expect(await news.countView(scheduled.slug)).toBe(false)

    await news.updateCategory(categoryId, normalizeNewsCategoryInput({ description: { en: '', vi: '' }, isVisible: false, name: { en: 'Test news', vi: 'Tin thử dbtest' }, slug: 'tin-thu-dbtest', sortOrder: 900 }), actor)
    expect(await news.publicPost(live.slug)).toBeNull()
    expect(await news.publicCategory('tin-thu-dbtest', 0, 9)).toBeNull()
  })

  it('keeps an old link of a published post working and stops other posts from taking it', async () => {
    const first = await news.createPost(post(), actor)
    const renamed = await news.updatePost(first.id, post({ slug: 'tin-doi-ten-dbtest', version: first.version }), actor)
    expect(renamed.post.previousSlugs).toEqual([first.slug])
    expect(await news.publicPost(first.slug)).toEqual({ redirectTo: 'tin-doi-ten-dbtest' })
    expect(await newsPageMeta(news, `/tin-tuc/${first.slug}`, 'vi')).toEqual({ redirect: '/tin-tuc/tin-doi-ten-dbtest' })
    expect(await rejection(news.createPost(post({ slug: first.slug, title: { en: 'Other', vi: 'Bài khác' } }), actor))).toBe('409 news_post_slug_taken')
    const meta = await newsPageMeta(news, '/tin-tuc/tin-doi-ten-dbtest', 'en')
    expect(meta).toMatchObject({ canonicalPath: '/tin-tuc/tin-doi-ten-dbtest', status: 200, title: 'First news | CEO Workforce Index', type: 'article' })
  })

  it('refuses a save made from an older copy', async () => {
    const created = await news.createPost(post(), actor)
    await news.updatePost(created.id, post({ title: { en: 'First news', vi: 'Sửa lần một' }, version: created.version }), actor)
    expect(await rejection(news.updatePost(created.id, post({ title: { en: 'First news', vi: 'Sửa từ bản cũ' }, version: created.version }), actor))).toBe('409 news_post_conflict')
  })

  it('removes pictures no post uses any more, and keeps shared ones', async () => {
    const inline = (await news.registerImage({ contentType: 'image/png', fileSize: 100, sha256: 'b'.repeat(64), storagePath: `news/dbtest/${Date.now()}-inline.png` }, actor)).id
    const created = await news.createPost(post({ content: { en: doc('Hello', inline), vi: doc('Xin chào', inline) } }), actor)
    const other = await news.createPost(post({ slug: 'bai-dung-chung-anh-dbtest', title: { en: 'Other', vi: 'Bài dùng chung ảnh' } }), actor)
    const updated = await news.updatePost(created.id, post({ version: created.version }), actor)
    expect(updated.removedImagePaths).toHaveLength(1)
    expect(await news.findImage(inline)).toBeNull()
    const removed = await news.deletePost(other.id, actor)
    // The cover is still used by the first post.
    expect(removed.removedImagePaths).toEqual([])
    expect(await news.findImage(coverId)).not.toBeNull()
    const history = await news.postHistory(created.id)
    // One test transaction gives every row the same time, so the order is not fixed here.
    expect(history.map((entry) => entry.action).sort()).toEqual(['news_post.create', 'news_post.update'])
  })

  it('starts with only the copy-link icon, then keeps the page links and switches with their history', async () => {
    await db.pool.query('DELETE FROM public.cwi_news_settings')
    const none = { on: false, url: '' }
    const start = { copyLink: true, social: { facebook: none, linkedin: none, youtube: none, zalo: none } }
    expect(await news.getSettings()).toEqual({ ...start, updatedAt: null, updatedByEmail: null })
    const withFacebook = normalizeNewsPageSettingsInput({ ...start, social: { ...start.social, facebook: { on: true, url: 'facebook.com/cwi' } } })
    const saved = await news.saveSettings(withFacebook, actor)
    expect(saved).toMatchObject({ copyLink: true, social: { facebook: { on: true, url: 'https://facebook.com/cwi' }, zalo: none } })
    expect(saved.updatedByEmail).toBe(actor.user.email)
    const hidden = { copyLink: false, social: { ...withFacebook.social, facebook: { on: false, url: 'https://facebook.com/cwi' } } }
    const again = await news.saveSettings(hidden, actor)
    expect(await news.getSettings()).toMatchObject(hidden)
    expect(again.updatedAt).not.toBeNull()
    const audit = await db.pool.query<{ metadata: { after: unknown; before: unknown } }>(
      `SELECT metadata FROM public.cwi_admin_audit_logs WHERE target_type = 'news_settings' AND action = 'news_settings.update' AND created_at = now()`,
    )
    expect(audit.rows).toHaveLength(2)
    expect(audit.rows.map((row) => row.metadata.before)).toContainEqual(start)
    expect(audit.rows.map((row) => row.metadata.after)).toContainEqual(hidden)
    // The database itself refuses an icon switched on without a link.
    await db.pool.query('BEGIN')
    expect(await rejection(db.pool.query(`UPDATE public.cwi_news_settings SET social_zalo_on = true WHERE id`))).toContain('23514')
    await db.pool.query('ROLLBACK')
  })
})
