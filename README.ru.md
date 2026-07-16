# Vibe Racing

> Статус: создаются безопасные persistence foundations для Phase 2/3. Production-сервис и готовый
> connector не выпущены.

Внешние contributions пока закрыты: сначала нужны реальные публичные maintainers, CODEOWNERS и
проверенные приватные каналы для security/conduct reports. Локальные имена и контакты не будут
копироваться в репозиторий ради заполнения этих полей.

Vibe Racing — открытый пиксельный недельный рейтинг пользователей Codex. Локальный connector
передаёт только заявленные пользователем дневные buckets, а участники отображаются как болиды на
общей трассе.

Сайт можно запустить локально без аккаунта, connector и базы: в этом случае он показывает явно
помеченное синтетическое превью. Видимая гонка и таблица теперь также запрашивают текущую неделю у
same-origin public score route и переключаются на Community results только после проверки ответа;
при ошибке остаётся синтетический fallback. Демо-профиль, три темы, русский/английский интерфейс и
reduced-motion режим работают без реальных данных.

## Модель доверия

Community-статистика предоставляется локальными устройствами и не подтверждается OpenAI. Её нельзя
использовать для денежных призов, авторизации, доступа к функциям или других ценных преимуществ.
Verified-лига останется выключенной до появления проверяемого сервером источника OpenAI.

Проект не собирает промпты, переписку, содержимое репозиториев, Codex access tokens, API-ключи или
произвольные пользовательские файлы.

## Документы

- [Публичный план реализации (EN)](docs/PROJECT_PLAN.md)
- [Текущий статус реализации (EN)](docs/IMPLEMENTATION_STATUS.md)
- [Security-инварианты (EN)](docs/architecture/SECURITY_INVARIANTS.md)
- [Threat model (EN)](docs/security/THREAT_MODEL.md)
- [Abuse cases (EN)](docs/security/ABUSE_CASES.md)
- [Privacy data map (EN)](docs/security/PRIVACY_DATA_MAP.md)
- [System context (EN)](docs/architecture/SYSTEM_CONTEXT.md) и
  [data flows (EN)](docs/architecture/DATA_FLOW.md)
- [Compatibility policy (EN)](docs/architecture/COMPATIBILITY_POLICY.md)
- [Версионированные публичные контракты (EN)](contracts/README.md)
- [Database foundation и role matrix (EN)](database/README.md)
- [Architecture decisions (EN)](docs/decisions/README.md)
- [Политика данных публичного репозитория (EN)](docs/security/PUBLIC_REPOSITORY_POLICY.md)
- [Локальная разработка (EN)](docs/getting-started/LOCAL_DEVELOPMENT.md)
- [Веб-прототип и его границы (EN)](apps/web/README.md)
- [Локальное Ingest verification kernel (EN)](apps/ingest/README.md)
- [Connector protocol foundation (EN)](crates/connector/README.md)
- [Dependency policy (EN)](docs/security/DEPENDENCY_POLICY.md)
- [Dependency inventory (EN)](docs/reference/dependency-inventory.json)
- [Происхождение визуальных assets (EN)](docs/reference/ASSET_PROVENANCE.md)
- [Индекс документации](docs/README.md)
- [Инструкции для coding agents](AGENTS.md)
- [Политика безопасности (EN)](SECURITY.md)
- [Правила участия (EN)](CONTRIBUTING.md)
- [Governance (EN)](GOVERNANCE.md)
- [Maintainers и publication gate (EN)](MAINTAINERS.md)
- [Code of conduct (EN)](CODE_OF_CONDUCT.md)
- [Support (EN)](SUPPORT.md)
- [Roadmap (EN)](ROADMAP.md)
- [Release policy (EN)](RELEASE.md)
- [English README](README.md)

## Важно

Все отслеживаемые Git-файлы считаются публичными. В репозиторий нельзя добавлять production-секреты,
персональные данные аккаунтов, приватные логи, реальные anti-abuse thresholds или локальные пути
компьютера.

Перед коммитом нужно выполнить `pnpm run verify`, затем проверить точный staged snapshot командой
`pnpm run check:public:staged` и вручную просмотреть `git diff --cached`.

Локальный запуск:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run dev:web
```

Dev-сервер слушает только loopback. В интерфейсе нет реальных пользователей или токенов; не
заменяйте синтетические fixtures приватными экспортами.

В репозитории уже есть пять закрытых JSON Schemas, генерируемые TypeScript validators и локально
реализованные OpenAPI GET и POST: sync request/result, bounded problem details, запрос одного
Community season и response-only top-32 Community score page с неизменяемыми
`community`/`selfReported` trust fields. Server-only fail-closed mapper преобразует в этот response
только точную десятиколоночную SQL projection и отклоняет malformed, inconsistent, oversized или
contract-invalid результаты. Bounded server-only PostgreSQL adapter использует отдельный
least-privileged Web login contract, certificate-verified production transport, four-connection
pool, проверку role/read-only state при каждом checkout, фиксированные deadlines и один
parameterized top-32 procedure call. Server-only HTTP problem factory генерирует opaque 128-bit
request IDs и закрытые contract-validated no-store error responses. Thin server-only route проверяет
точный query, GET-only method/`Accept`, no-queue admission на четыре запроса, adapter deadlines,
store-error translation и финальный response contract. Это локальная реализация, а не deployment:
cache, deployment login/TLS integration, edge rate policy, operational connector и приём реальной
статистики ещё отсутствуют. Отдельное чистое Ingest kernel теперь копирует и ограничивает точные raw
body/headers Community sync, до JSON и device lookup проверяет body-bound origin HMAC с одноразовым
nonce, отклоняет дубликаты headers/decoded JSON keys и превышение parser budgets, валидирует sync
contract и строго проверяет source-bound Ed25519 request. Оно возвращает только frozen
database-ready allowlist. Отдельный bounded Ingest PostgreSQL adapter повторно проверяет этот
allowlist, копирует binary/array parameters, при каждом checkout проверяет точный least-privileged
Ingest login/role и вызывает только fixed origin-replay consume, device lookup или submission через
four-client pool с deadlines. Без TLS разрешён только loopback development/test, в остальных случаях
обязательна certificate verification. Тесты используют mock pools и не содержат рабочего login.
Локальная protected factory теперь требует точную primary origin-HMAC пару и допускает только одну
полную distinct rotation-пару из namespaced configuration; наружу она возвращает только verifier, а
реальных key и secret-manager binding в репозитории нет. Forced-RLS PostgreSQL table хранит только
origin key ID, domain-separated nonce digest и millisecond expiry; Ingest-only function атомарно
consume-ит tuple, а observed race доказывает одного победителя. Transport-free application boundary
теперь генерирует server-owned request ID, связывает этот replay/device/submission adapter с точным
verifier, дожидается settlement базы и возвращает только валидированный acknowledgement либо generic
problem decision. Отдельная локальная Fastify server factory сохраняет точные raw body/header
evidence для `POST /v1/community/sync`, не доверяет proxy headers и входящему request ID, без
очереди допускает четыре application call, ограничивает parser/headers/connections и задаёт
5/33/34-second request/handler/connection deadlines, после чего сериализует только повторно
проверенные `no-store` success/problem contracts. Есть loopback и injection evidence, но нет
deployment entry point. Live protected key injection, edge signer, direct-origin denial,
host/port/TLS configuration, distributed rate policy и monitoring всё ещё отсутствуют. Library-only
Rust foundation теперь выполняет фиксированный stable handshake и только после него — candidate
`0.144.4` account/usage sequence. Он подтверждает ChatGPT mode, отбрасывает email/plan/summary и
возвращает не более 31 отсортированной строгой date/token записи. В репозитории есть exact release
metadata, schema digests, minimal extracts, fixtures и drift/matrix checker, но официальный artifact
не был независимо выполнен, а support matrix остаётся пустой. One-shot supervisor теперь проверяет
точную sequence на target-built synthetic child: фиксированный `app-server` argument, local pipes,
очищенное ambient environment, bounded stdout/stderr/time, отклонение late output и
reap-before-success cleanup. У reviewed-launch capability нет публичного constructor. Второй
недоступный reviewed context теперь позволяет candidate composer превратить минимизированные записи
в точные `ConnectorSyncV1` JSON, SHA-256 digest, unpadded base64url nonce и LF-separated
device-signature message. Изолированный one-use signer потребляет этот закрытый материал вместе с
таким же недоступным device-bound Ed25519 key capability и возвращает только то же body и пять
точных header values. Общий synthetic vector проверяет exact public key/signature между Rust и
production Ingest verifier. Поэтому executable discovery, link/path ownership и artifact/version
admission, реальный запуск Codex, cross-platform evidence, source/device context provider, secure
key generation/store, pairing proof, signed upload, operational connector, live database connection,
load evidence и deployment всё ещё отсутствуют.

Также добавлены двенадцать SQL migrations: 24 приватные
identity/passkey/recovery/source/device/pairing/audit/deletion/replay/usage/scoring tables,
deny-by-default runtime roles, forced RLS и интеграционный тест на одноразовом PostgreSQL. Узкая
procedure boundary уже покрывает выдачу invite, атомарное enrollment, привязанный к сессии
initial-passkey challenge, вход с сессией, привязанной к точному passkey, управление несколькими
passkeys, rotate/revoke сессии, немедленную блокировку при запросе удаления и одноразовую привязку
устройства к новому или существующему opaque source. Также реализованы приватный inventory
источников и устройств, pause/reactivation/unlink источника и немедленный revoke устройства. Для
критических действий база сохраняет точный passkey step-up. Реализованы также защищённая
passkey-проверкой замена recovery-кодов и отдельное краткоживущее право только на регистрацию нового
passkey: обычная сессия создаётся лишь после успешной замены, а использованный PHC сразу удаляется.
Проверяющего Argon2id/WebAuthn приложения пока нет. Database-only scoring refresh уже суммирует
distinct eligible sources одного профиля перед единым дневным лимитом, закрепляет immutable версию
формулы за ISO-week season и сохраняет только derived score/rank/active-days/source-count без raw
tokens и source IDs. Database-only finalization закрывает grace window через 48 часов после ISO-week
по server time, сохраняет late snapshot только как quarantined evidence и делает terminal season
неизменяемым, сохраняя profile-purge. Отдельная Web-only database projection возвращает только
bounded active-profile score rows без raw values, private IDs и exact timestamps. Email и
идентификатор Codex-аккаунта не читаются и не сохраняются. Response schema фиксирует тот же public
allowlist, а server-only mapper, bounded Web PostgreSQL adapter и локальный score route проверяют
форму, season/rank invariants, database role и contract до сериализации. Видимая гонка и таблица
теперь запрашивают у этого route текущую server-selected неделю без credentials, проверяют только
public поля и честно сохраняют synthetic fallback при недоступности. HTTP login/recovery routes,
OAuth callback, Argon2id/WebAuthn и pairing-possession verifier, generic auth-response translation и
edge rate limits для анонимных challenges и recovery lookup пока отсутствуют. Database-only
Community ingest capability уже выдаёт минимальный материал активного устройства и принимает bounded
source-bound snapshots с exact retry, nonce replay, monotonic source/date, quarantine и
lifecycle-race enforcement. Отдельная Jobs-only procedure независимо удаляет bounded batches
истёкших origin nonces, device nonces и raw snapshots, сохраняя current source/day values. Локальный
one-shot Jobs runner теперь вызывает только cleanup, scoring refresh или finalization через
отдельный least-privileged config, single-client pool, проверку role/login/search path, fixed
deadlines, prepared parameters, closed result validation и стабильный non-reflective CLI output.
Сама база не проверяет wire signature; локальные kernel, adapter и application объединены на
synthetic/mock-pool evidence, а Fastify boundary отдельно проверена через injection/loopback с mock
application. Полный HTTP-to-PostgreSQL path не проверен через реальный login. Deployed HTTP ingest
route, pairing-possession verifier, operational connector, cleanup/scoring scheduler, live
Ingest/Jobs login/TLS integration, monitoring backend, deployed public score read, audited
correction flow, purge worker и deployed database ещё не реализованы, поэтому готовой
пользовательской авторизации, публичного рейтинга и приёма реальных данных пока нет.

Отдельная команда `pnpm run check:publication` сейчас должна завершаться ошибкой: она блокирует
публикацию, пока реальные GitHub-настройки и ответственные лица не подтверждены.
