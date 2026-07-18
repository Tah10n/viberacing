# Vibe Racing

> Статус: реализуются локальные vertical slices Phase 2/3. Production-сервис и готовый connector не
> выпущены.

Внешние contributions пока закрыты: сначала нужны реальные публичные maintainers, CODEOWNERS и
проверенные приватные каналы для security/conduct reports. Локальные имена и контакты не будут
копироваться в репозиторий ради заполнения этих полей.

Vibe Racing — открытый пиксельный недельный рейтинг пользователей Codex. Локальный connector
передаёт только заявленные пользователем дневные buckets, а участники отображаются как болиды на
общей трассе.

Сайт можно запустить локально без аккаунта, connector и базы: в этом случае он показывает явно
помеченное синтетическое превью. Видимая гонка и таблица теперь также запрашивают текущую неделю у
same-origin public race-status route и переключаются на Community results только после проверки
ответа. Ответ всегда содержит округлённую до полных UTC-дней freshness и может содержать текущий
approved enum-only автомобиль и включённый пользователем streak; exact receipt time и underlying
daily scores остаются private. При отсутствии автомобиля браузер использует repository-owned
presentation fallback. При ошибке остаётся синтетический fallback. Демо-профиль, три темы,
русский/английский интерфейс и reduced-motion режим работают без реальных данных. Отдельный
invite-only flow теперь локально соединяет GitHub OAuth со state и PKCE, зашифрованное краткоживущее
продолжение, атомарное enrollment, обязательную регистрацию passkey, повторный
discoverable-credential вход, session-scoped список ключей доступа, страницу активного профиля,
hide/show публичного профиля, список источников и устройств, немедленную паузу источника,
восстановление paused-источника после свежей проверки passkey, необратимое отключение источника со
свежей проверкой passkey, немедленный отзыв устройства, добавление резервного passkey, защищённый
отзыв не текущего passkey, запрос удаления профиля после точного ввода handle и свежей проверки
passkey, ротацию кодов восстановления с одноразовым показом после свежей проверки passkey, а также
logout. Репозиторий не предоставляет рабочий invite issuer, вход по коду восстановления или замену
passkey, OAuth registration, реальные secrets, live OAuth/authenticator/database credentials,
scheduled deletion purge, cache/backup/tombstone handling, restore replay, edge abuse controls или
evidence с реальным пользователем.

Страница аккаунта теперь также рендерит семь derived-баллов по дням текущей Community-недели и
bounded summary через один объединённый server-side visibility/score checkout. Hidden-профиль не
показывает score; raw usage, private identifiers, browser fetch и browser storage не добавлены.

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
- [Локальный bounded Agent Skill для car proposal (EN)](.agents/skills/viberacing-propose-car/SKILL.md)
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

Полные синтетические loopback Ingest и Jobs paths отдельно проверяются командами
`pnpm run test:ingest:postgres-integration` и `pnpm run test:jobs:postgres-integration`; они требуют
Docker и не являются deployment evidence.

Dev-сервер слушает только loopback. В интерфейсе нет реальных пользователей или токенов; не
заменяйте синтетические fixtures приватными экспортами.

В репозитории уже есть тринадцать закрытых JSON Schemas, генерируемые TypeScript validators и
локально реализованные OpenAPI GET и POST: sync request/result, bounded problem details, запрос
одного Community season, response-only top-32 Community score page и отдельный совместимый race page
с optional exact `CarRecipeV1`, а также третий совместимый race-status page с rounded freshness и
optional streak. Два прежних contract и route остаются неизменными. Server-only fail-closed mappers
принимают только точные десяти-, одиннадцати- или тринадцатиколоночные SQL projections и отклоняют
malformed, inconsistent, oversized или contract-invalid результаты. Bounded server-only PostgreSQL
adapter использует отдельный least-privileged Web login contract, certificate-verified production
transport, four-connection pool, проверку role/read-only state при каждом checkout, фиксированные
deadlines и один parameterized top-32 procedure call. Server-only HTTP problem factory генерирует
opaque 128-bit request IDs и закрытые contract-validated no-store error responses. Thin server-only
route проверяет точный query, GET-only method/`Accept`, no-queue admission на четыре запроса,
adapter deadlines, store-error translation и финальный response contract. Это локальная реализация,
а не deployment: cache, deployment login/TLS integration, edge rate policy, operational connector и
приём реальной статистики ещё отсутствуют. Отдельное чистое Ingest kernel теперь копирует и
ограничивает точные raw body/headers Community sync, до JSON и device lookup проверяет body-bound
origin HMAC с одноразовым nonce, отклоняет дубликаты headers/decoded JSON keys и превышение parser
budgets, валидирует sync contract и строго проверяет source-bound Ed25519 request. Оно возвращает
только frozen database-ready allowlist. Отдельный bounded Ingest PostgreSQL adapter повторно
проверяет этот allowlist, копирует binary/array parameters, при каждом checkout проверяет точный
least-privileged Ingest login/role и вызывает только fixed origin-replay consume, device lookup или
submission через four-client pool с deadlines. Без TLS разрешён только loopback development/test, в
остальных случаях обязательна certificate verification. Focused tests используют mock pools.
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
проверенные `no-store` success/problem contracts. Отдельный локальный host теперь запускает именно
эту factory только в loopback development/test либо с явным Railway-edge production contract,
закрывает частично созданные boundary и ограниченно обрабатывает SIGINT/SIGTERM. Его 121 test и
built-entrypoint check не доказывают Railway, внешний TLS, edge route, live credentials или
deployment. Отдельный opt-in integration test собирает emitted host, создаёт синтетический
выделенный Ingest login в одноразовом PostgreSQL, отправляет независимо подписанные loopback HTTP
requests и проверяет accepted, duplicate, persistent replay, revoked device, response headers и
точные сохранённые строки до полного cleanup. Он не доказывает deployment credential/certificate,
protected secret delivery, внешний edge route, real-user data или capacity. Live protected key
injection, edge signer, direct-origin denial, distributed rate policy и monitoring всё ещё
отсутствуют. Library-only Rust foundation теперь выполняет фиксированный stable handshake и только
после него — candidate `0.144.5` account/usage sequence. Он подтверждает ChatGPT mode, отбрасывает
email/plan/summary и возвращает не более 31 отсортированной строгой date/token записи. В репозитории
есть exact release metadata, schema digests, minimal extracts, fixtures и drift/matrix checker.
Windows x86_64 development-команда допускает только точные size и SHA-256 официального artifact;
repository tests не запускают пользовательский Codex account, а support matrix остаётся пустой.
One-shot supervisor проверяет точную sequence на target-built synthetic child: фиксированный
`app-server` argument, local pipes, очищенное ambient environment, bounded stdout/stderr/time,
отклонение late output и reap-before-success cleanup. Reviewed-launch capability остаётся приватной
для exact admission. Второй недоступный reviewed context теперь позволяет candidate composer
превратить минимизированные записи в точные `ConnectorSyncV1` JSON, SHA-256 digest, unpadded
base64url nonce и LF-separated device-signature message. Изолированный one-use signer потребляет
этот закрытый материал вместе с таким же недоступным device-bound Ed25519 key capability и
возвращает только то же body и пять точных header values. Общий synthetic vector проверяет exact
public key/signature между Rust и production Ingest verifier. Отдельные pairing signer и Web
verifier согласованы по точному domain-separated possession message. Локальная signed-in страница
`/connect` принимает короткий код, показывает ограниченные metadata и полный fingerprint публичного
ключа, явно выбирает новый или активный существующий opaque source без раскрытия его raw ID, а перед
атомарным одобрением точного выбора требует свежий passkey assertion. Два закрытых локальных POST
route открывают versioned pairing start/poll contracts через общий лимит в четыре вызова,
фиксированную глобальную и 64-bucket PostgreSQL rate policy, ограниченные body и generic `no-store`
ответы. Локальная Rust-команда `connect` получает Ed25519 key и анонимный rate ID из OS CSPRNG,
сохраняет prepared/pending/active record только в нативном credential store, доказывает владение
ключом и возобновляет прерванный poll, не печатая key, token, challenge, source или device ID.
Отдельная точная команда `forget-local` может удалить только эту нативную запись для canonical
origin/label, не читая её и не обращаясь к Vibe Racing; фиксированный результат предупреждает, что
команда не выполняет server device revoke: он остаётся отдельным authenticated account action.
Отдельная Windows x86_64 команда `sync` canonicalize-ит и hash-проверяет один exact `0.144.5`
executable, запускает его в новом пустом working directory, создаёт свежие request time/ID/nonce из
active record, один раз отправляет точное signed body на фиксированный sync path и принимает только
closed acknowledgement. Она не ищет binary автоматически, не повторяет ambiguous POST и не
отправляет edge origin proof. Всё ещё нет macOS/Linux admission, live database connection, capacity
evidence, credential rotation, automatic server-revoke composition, packaging, release,
поддерживаемого sync connector и deployment.

Также добавлены двадцать девять SQL migrations: 27 приватных
identity/passkey/recovery/source/device/pairing/audit/deletion/replay/usage/scoring/CarRecipe
tables, deny-by-default runtime roles, forced RLS и интеграционный тест на одноразовом PostgreSQL.
Узкая procedure boundary уже покрывает выдачу invite, атомарное enrollment, привязанный к сессии
initial-passkey challenge, вход с сессией, привязанной к точному passkey, управление несколькими
passkeys, rotate/revoke сессии, немедленную блокировку при запросе удаления и одноразовую привязку
устройства к новому или существующему opaque source. Также реализованы приватный inventory
источников и устройств, pause/reactivation/unlink источника и немедленный revoke устройства. Для
критических действий база сохраняет точный passkey step-up. Реализованы также защищённая
passkey-проверкой замена recovery-кодов и отдельное краткоживущее право только на регистрацию нового
passkey: обычная сессия создаётся лишь после успешной замены, а использованный PHC сразу удаляется.
Локальный identity flow теперь проверяет initial WebAuthn registration, returning
discoverable-credential login, fresh step-up для отзыва owned non-current passkey и fresh passkey
для reactivation paused-источника. Source ID не попадает в HTML: страница получает только
зашифрованный привязанный к сессии control token на 15 минут. Pause выполняется сразу, reactivation
доступна только для `paused` и не меняет public/hidden visibility. Необратимый unlink использует
отдельный fresh-passkey context, атомарно отзывает устройства источника и также не публикует hidden
профиль. Database-only scoring refresh уже суммирует distinct eligible sources одного профиля перед
единым дневным лимитом, закрепляет immutable версию формулы за ISO-week season и сохраняет только
derived score/rank/active-days/source-count без raw tokens и source IDs. Database-only finalization
закрывает grace window через 48 часов после ISO-week по server time, сохраняет late snapshot только
как quarantined evidence и делает terminal season неизменяемым, сохраняя profile-purge. Отдельная
Web-only database projection возвращает только bounded active-profile score rows без raw values,
private IDs и exact timestamps. Email и идентификатор Codex-аккаунта не читаются и не сохраняются.
Response schemas фиксируют отдельные закрытые public allowlists, а server-only mappers, bounded Web
PostgreSQL adapter и локальные score/race/status routes проверяют форму, season/rank invariants,
database role и contract до сериализации. Status route добавляет только complete-UTC-day freshness и
optional preference-gated streak без exact timestamps или daily rows. Видимая гонка и таблица
запрашивают у него текущую server-selected неделю без credentials, проверяют только public поля и
честно сохраняют synthetic fallback при недоступности. Локальные invite/OAuth/
initial-passkey/returning-login routes теперь существуют; login options хранят profile-free
challenge только в encrypted cookie, а валидный assertion атомарно создаёт и тут же поглощает
database challenge при выдаче сессии. Страница аккаунта по той же подтверждённой сессии показывает
только названия ключей, active/revoked state, округлённую дату создания и отметку текущего
authenticator; credential IDs и key material не рендерятся. Для owned non-current passkey страница
отправляет только opaque ID, требует свежий user-verified assertion с привязкой к сессии и цели и
вызывает атомарный consume-and-revoke; текущий или последний активный ключ удалить нельзя. Отдельный
add-flow заранее валидирует и шифрует label, затем требует независимые assertion существующим ключом
и регистрацию нового; один database statement атомарно consume-ит step-up и добавляет credential в
пределах lifetime cap 32. Application verifier для ротации кодов восстановления теперь после свежего
passkey assertion создаёт десять кодов, атомарно сохраняет только защищённые verifier values и
показывает plaintext один раз. Локальные recovery-code sign-in, replacement-passkey и WebAuthn
pairing approval реализованы только с injected/synthetic evidence; live authenticator/database
integration, edge rate/capacity controls и deployment всё ещё отсутствуют. Отдельный локальный
CarRecipe slice принимает только точный versioned enum-only объект, хранит не более одного
приватного proposal на 24 часа для выведенного из сессии профиля, показывает его во всех трёх темах
и требует явный зашифрованный session-bound approve или reject control. Approval атомарно заменяет
active recipe. Отдельный device-authenticated Web route и фиксированная команда `propose-car` могут
только создать или заменить тот же pending exact recipe для активного source-bound device; читать,
approve, reject или activate его они не могут. Cross-profile и non-Web database capabilities
запрещены. Проверяемый локальный Agent Skill сводит style request к точным recipe flags, требует
явно переданные shell-safe origin/label, один раз вызывает только эту команду и не получает read или
decision authority. Отдельная Jobs-only capability теперь bounded oldest- first batches физически
удаляет expired proposal, сохраняя live proposals и active recipes. Отдельный совместимый public
race contract показывает только текущий approved recipe активного профиля. Третий совместимый public
race-status contract отдельно добавляет округлённую freshness и включённый пользователем streak;
proposal identity, state, exact timestamps, daily scores и private preference не выходят наружу, а
стабильные score и прежний race response не меняются. Schedule для cleanup, live credentials,
release/packaging connector, edge controls и deployment остаются отдельными воротами. Database-only
Community ingest capability уже выдаёт минимальный материал активного устройства и принимает bounded
source-bound snapshots с exact retry, nonce replay, monotonic source/date, quarantine и
lifecycle-race enforcement. Отдельная Jobs-only procedure независимо удаляет bounded batches
истёкших origin nonces, device nonces и raw snapshots, сохраняя current source/day values. Ещё две
отдельные Jobs-only процедуры удаляют bounded expired pairing state и истёкшие auth
challenges/restricted recovery authorities, сохраняя live ceremonies, unused recovery codes,
sessions, passkeys и audit evidence. Ещё одна Jobs-only procedure удаляет не более 1000 expired
CarRecipe proposals за вызов под отдельным private mutex и не затрагивает active recipes. Отдельная
Jobs-only procedure bounded batches удаляет eligible expired browser sessions без retained rotation
predecessor или pairing approval provenance, сохраняя live и referenced sessions. Ещё одна Jobs-only
procedure атомарно удаляет до 10 due `deletion_pending` профилей, сначала снимает restrictive
pairing references, terminally settles opaque job и не создаёт неподтверждённый tombstone. Локальный
one-shot Jobs runner вызывает только одну из восьми fixed capabilities:
auth/CarRecipe-proposal/ingest/pairing/session cleanup, primary profile purge, scoring refresh или
finalization через отдельный least-privileged config, single-client pool, проверку role/login/search
path, fixed deadlines, prepared parameters, closed result validation и стабильный non-reflective CLI
output. Отдельный opt-in Jobs scenario применяет reviewed migrations к одноразовой PostgreSQL,
запускает все восемь emitted commands через узкий synthetic login, отклоняет login с лишней role
membership до мутации и проверяет точное состояние перед очисткой. Сама база не проверяет wire
signature; локальные kernel, adapter и application объединены на synthetic/mock-pool evidence.
Отдельный opt-in loopback Ingest scenario теперь проводит независимо подписанный HTTP request через
emitted host и одноразовый least-privileged PostgreSQL login, включая duplicate/replay/revoke и
точную проверку сохранённого состояния. Deployed HTTP ingest route, operational sync connector,
cleanup/scoring scheduler, deployment Ingest/Jobs login/TLS integration, monitoring backend,
deployed public score read, audited correction flow, cache/backup/tombstone purge, restore replay и
scheduled deletion execution ещё не реализованы, поэтому локальный enrollment ещё не является
готовой production-авторизацией, а приёма реальных данных пока нет.

Отдельная команда `pnpm run check:publication` сейчас должна завершаться ошибкой: она блокирует
публикацию, пока реальные GitHub-настройки и ответственные лица не подтверждены.
