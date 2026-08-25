# RabbitMQ for CWI

This RabbitMQ is isolated from the LANDA RabbitMQ.

## Isolation rules

- Do not use the nesso-rabbitmq container.
- Do not use the rabbitmq-local Compose project.
- Do not use the rabbitmq-local_rabbitmq_data volume.
- Do not use the rabbitmq-local_default network.
- Never bind AMQP or Management UI to a public address.

## Local

LANDA uses 127.0.0.1:5672 and 127.0.0.1:15672. CWI local uses separate ports:

- AMQP: 127.0.0.1:5673
- Management UI: 127.0.0.1:15673

```powershell
Set-Location D:\CWI\cwi-backend\deploy\rabbitmq
Copy-Item .env.example .env
# Replace RABBITMQ_DEFAULT_PASS with a random secret before starting.
docker compose --env-file .env -p cwi-rabbitmq-local up -d
docker compose --env-file .env -p cwi-rabbitmq-local ps
```

Open http://127.0.0.1:15673 for the local Management UI.

## SSH production

Create a separate .env in this directory on SSH:

```dotenv
COMPOSE_PROJECT_NAME=cwi-rabbitmq-production
RABBITMQ_CONTAINER_NAME=cwi-rabbitmq-production
RABBITMQ_HOSTNAME=cwi-rabbitmq-production
RABBITMQ_AMQP_PORT=5672
RABBITMQ_MANAGEMENT_PORT=15672
RABBITMQ_DEFAULT_USER=cwi_admin
RABBITMQ_DEFAULT_PASS=<unique-production-secret>
RABBITMQ_DEFAULT_VHOST=cwi_vhost
RABBITMQ_VOLUME_NAME=cwi-rabbitmq-production-data
RABBITMQ_NETWORK_NAME=cwi-rabbitmq-production-network
```

Start it from deploy/rabbitmq:

```bash
docker compose --env-file .env -p cwi-rabbitmq-production up -d
docker compose --env-file .env -p cwi-rabbitmq-production ps
```

Access the production Management UI through an SSH tunnel:

```powershell
ssh -L 15672:127.0.0.1:15672 ubuntu@18.139.252.111
```

Then open http://127.0.0.1:15672 locally.

## Stop and rollback

Only stop the CWI instance with its own project:

```bash
docker compose --env-file .env -p cwi-rabbitmq-production down
```

Do not use --volumes for normal operations. Do not run docker system prune.
