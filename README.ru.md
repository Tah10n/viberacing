# Vibe Racing

> Статус: идёт Phase 2 — безопасный persistence foundation. Production-сервис и готовый connector не
> выпущены.

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

В репозитории уже есть закрытые JSON Schemas и генерируемые TypeScript/OpenAPI artifacts для
будущего sync-протокола. Это пока только проверяемая граница данных: работающего API, connector и
приёма реальной статистики ещё нет.

Также добавлены две SQL migrations: 13 приватных identity/source/device/pairing/audit/deletion
tables, deny-by-default runtime roles, forced RLS и интеграционный тест на одноразовом PostgreSQL.
Узкая procedure boundary уже покрывает выдачу invite, атомарное enrollment, привязанный к сессии
initial-passkey challenge, rotate/revoke сессии и немедленную блокировку при запросе удаления. Но
HTTP-auth routes, OAuth callback, WebAuthn verifier, connector ingest, purge worker и deployed
database ещё не реализованы, поэтому готовой пользовательской авторизации пока нет.

Отдельная команда `pnpm run check:publication` сейчас должна завершаться ошибкой: она блокирует
публикацию, пока реальные GitHub-настройки и ответственные лица не подтверждены.
