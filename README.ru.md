# Vibe Racing

> Статус: создаются безопасные persistence foundations для Phase 2/3. Production-сервис и готовый
> connector не выпущены.

Внешние contributions пока закрыты: сначала нужны реальные публичные maintainers, CODEOWNERS и
проверенные приватные каналы для security/conduct reports. Локальные имена и контакты не будут
копироваться в репозиторий ради заполнения этих полей.

Vibe Racing — открытый пиксельный недельный рейтинг пользователей Codex. Локальный connector
передаёт только заявленные пользователем дневные buckets, а участники отображаются как болиды на
общей трассе.

Сейчас сайт уже можно запустить локально, но он намеренно использует только синтетические данные:
без аккаунта, connector, подключённой базы приложения, аналитики и реальной статистики. Так можно
проверить гонку, таблицу, профиль, три темы, русский/английский интерфейс и reduced-motion режим.

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

В репозитории уже есть пять закрытых JSON Schemas, генерируемые TypeScript validators и один
локально реализованный OpenAPI GET: sync request/result, bounded problem details, запрос одного
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
cache, deployment login/TLS integration, edge rate policy, connector и приём реальной статистики ещё
отсутствуют.

Также добавлены одиннадцать SQL migrations: 23 приватные
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
форму, season/rank invariants, database role и contract до сериализации, но route не подключён к
видимой synthetic странице. HTTP auth/recovery routes, OAuth callback, Argon2id/WebAuthn/Ed25519
verifier, generic response и edge rate limits для анонимных challenges и recovery lookup пока
отсутствуют. Database-only Community ingest capability уже выдаёт минимальный материал активного
устройства и принимает bounded source-bound snapshots с exact retry, nonce replay, monotonic
source/date, quarantine и lifecycle-race enforcement. Отдельная Jobs-only procedure удаляет bounded
batches истёкших nonces и raw snapshots, сохраняя current source/day values, но scheduler для неё
отсутствует. Сама база не проверяет wire signature. HTTP ingest route, приложение с
Ed25519-проверкой, connector, cleanup/scoring scheduler или service, deployed public score read,
audited correction flow, purge worker и deployed database login/TLS ещё не реализованы, поэтому
готовой пользовательской авторизации, публичного рейтинга и приёма реальных данных пока нет.

Отдельная команда `pnpm run check:publication` сейчас должна завершаться ошибкой: она блокирует
публикацию, пока реальные GitHub-настройки и ответственные лица не подтверждены.
