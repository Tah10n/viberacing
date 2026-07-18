import type { CarChassis } from "./car-recipe";

export const locales = ["en", "ru"] as const;
export type Locale = (typeof locales)[number];

const english = {
  account: "Account",
  activeDays: "Active days",
  brand: "Vibe Racing",
  car: "Car",
  carProposal: "Next-week car proposal",
  communityDetail:
    "Scores are self-reported by participating users. They are not audited or endorsed by OpenAI.",
  communityDataBadge: "Community standings",
  communityDataSecurityNote:
    "Community standings contain only public derived scores and day-rounded status. Cars are visual markers until profile recipes exist. This page uses no trackers, remote fonts, account credentials, or raw token totals.",
  communityCarCopy:
    "This car is a stable visual marker for the standings, not a published profile recipe.",
  communityNotice: "Community leaderboard",
  communityProfile: "Community profile",
  communityProfilePrivacy:
    "Daily detail, exact sync time, token totals, device counts, and source identifiers stay private.",
  communityWeek: "Current Community week",
  currentWeek: "Current demo week",
  dailyActivity: "Daily score",
  dataControl: "Data control",
  dataControlCopy:
    "The production profile will offer source removal, export, and deletion. This preview stores no account data.",
  demoBadge: "Synthetic preview",
  fallbackBadge: "Synthetic fallback",
  demoProfile: "Demo garage",
  deviceCount: "Devices",
  driver: "Driver",
  exactTokensPrivate: "Exact token counts and source identifiers stay private.",
  freshness: "Freshness",
  heroCopy:
    "A privacy-first weekly leaderboard where coding activity becomes a deterministic pixel-art race.",
  heroTitle: "Build fast. Race fair.",
  joinRace: "Join with invite",
  language: "Language",
  leaderboard: "Leaderboard",
  liveRace: "Weekly race",
  methodology: "Scoring method",
  methodologyCopy:
    "Each day uses a capped logarithmic score. Weekly rank uses score, then active days; equal results share a rank. Streak and freshness are informational only.",
  motion: "Motion",
  motionOff: "Reduced",
  motionOn: "On",
  motionSystem: "Device setting",
  noGlobalClaim: "Ranking covers Vibe Racing participants only — never every Codex user.",
  noParticipants: "No Community participants yet.",
  noRawTokens: "No raw token totals",
  pauseRace: "Pause race",
  points: "pts",
  primaryNavigation: "Primary navigation",
  privacyByDefault: "Privacy by default",
  profile: "Profile",
  profileNotRanked: "This profile is not in the current top 32.",
  rank: "Rank",
  resumeRace: "Resume race",
  score: "Weekly score",
  securityNote:
    "This page uses synthetic fixtures, no trackers, no remote fonts, and no account or connector credentials.",
  sharedRank: "Shared rank",
  signIn: "Sign in",
  simulator: "Score simulator",
  simulatorActiveDays: "Active days this week",
  simulatorCopy:
    "Try the public Community formula with a hypothetical daily token total. Nothing leaves this page, is stored, or changes a standing.",
  simulatorDailyResult: "Points per active day",
  simulatorInvalidInput: "Enter a whole number from 0 through 9,007,199,254,740,991.",
  simulatorTokenLabel: "Hypothetical tokens per active day",
  simulatorWeeklyResult: "Projected weekly score",
  sourceCount: "Sources",
  sourcesAggregated: "Multiple accounts can be summed as separate approved sources.",
  streak: "Streak",
  streakUnavailable: "—",
  theme: "Theme",
  themeClassic: "Classic Grand Prix",
  themeCyber: "Cyber Rally",
  themeNeon: "Neon Night Arcade",
  todayScore: "Today",
  unavailable: "Unavailable",
  verified: "Verified league",
  verifiedCopy: "Disabled until an authoritative verification boundary exists.",
  visualMarker: "Visual marker",
  viewLeaderboard: "View standings",
  viewProfile: "View profile",
} as const;

export type TranslationKey = keyof typeof english;

const russian: Record<TranslationKey, string> = {
  account: "Аккаунт",
  activeDays: "Активные дни",
  brand: "Vibe Racing",
  car: "Машина",
  carProposal: "Машина на следующую неделю",
  communityDetail:
    "Результаты заявляют сами участники. Они не проверяются и не подтверждаются OpenAI.",
  communityDataBadge: "Рейтинг сообщества",
  communityDataSecurityNote:
    "В рейтинге сообщества отображаются только публичные производные баллы и округлённый до дня статус. Машины служат визуальными маркерами, пока нет рецептов профиля. Здесь нет трекеров, внешних шрифтов, данных входа и точных токенов.",
  communityCarCopy:
    "Эта машина — постоянный визуальный маркер в таблице, а не опубликованный рецепт профиля.",
  communityNotice: "Рейтинг сообщества",
  communityProfile: "Профиль сообщества",
  communityProfilePrivacy:
    "Баллы по дням, точное время синхронизации, токены, число устройств и идентификаторы источников остаются приватными.",
  communityWeek: "Текущая неделя сообщества",
  currentWeek: "Текущая демо-неделя",
  dailyActivity: "Баллы по дням",
  dataControl: "Управление данными",
  dataControlCopy:
    "В рабочем профиле можно будет удалить источник, экспортировать и удалить данные. Превью не хранит данные аккаунта.",
  demoBadge: "Синтетическое превью",
  fallbackBadge: "Синтетический резерв",
  demoProfile: "Демо-гараж",
  deviceCount: "Устройства",
  driver: "Пилот",
  exactTokensPrivate: "Точные токены и идентификаторы источников остаются приватными.",
  freshness: "Обновление",
  heroCopy:
    "Приватный недельный рейтинг, где активность в кодинге превращается в детерминированную пиксельную гонку.",
  heroTitle: "Коди быстро. Гоняй честно.",
  joinRace: "Войти по приглашению",
  language: "Язык",
  leaderboard: "Таблица лидеров",
  liveRace: "Недельная гонка",
  methodology: "Формула баллов",
  methodologyCopy:
    "За день начисляются ограниченные логарифмические баллы. Ранг зависит от суммы и активных дней; равные результаты делят место. Серия и обновление носят только справочный характер.",
  motion: "Анимация",
  motionOff: "Снижена",
  motionOn: "Включена",
  motionSystem: "Как на устройстве",
  noGlobalClaim: "Рейтинг охватывает только участников Vibe Racing, а не всех пользователей Codex.",
  noParticipants: "В рейтинге сообщества пока нет участников.",
  noRawTokens: "Без публикации токенов",
  pauseRace: "Остановить гонку",
  points: "б.",
  primaryNavigation: "Основная навигация",
  privacyByDefault: "Приватность по умолчанию",
  profile: "Профиль",
  profileNotRanked: "Этого профиля нет в текущей тридцатке лидеров.",
  rank: "Место",
  resumeRace: "Продолжить гонку",
  score: "Баллы за неделю",
  securityNote:
    "На странице только синтетические данные: без трекеров, внешних шрифтов, аккаунтов и ключей коннектора.",
  sharedRank: "Общее место",
  signIn: "Войти",
  simulator: "Симулятор баллов",
  simulatorActiveDays: "Активные дни за неделю",
  simulatorCopy:
    "Проверьте публичную формулу Community на условном числе токенов за день. Значение не покидает страницу, не сохраняется и не влияет на рейтинг.",
  simulatorDailyResult: "Баллы за активный день",
  simulatorInvalidInput: "Введите целое число от 0 до 9 007 199 254 740 991.",
  simulatorTokenLabel: "Условные токены за активный день",
  simulatorWeeklyResult: "Баллы за неделю",
  sourceCount: "Источники",
  sourcesAggregated:
    "Несколько аккаунтов можно суммировать как отдельные подтверждённые источники.",
  streak: "Серия",
  streakUnavailable: "—",
  theme: "Тема",
  themeClassic: "Классический гран-при",
  themeCyber: "Кибер-ралли",
  themeNeon: "Неоновая аркада",
  todayScore: "Сегодня",
  unavailable: "Недоступно",
  verified: "Проверенная лига",
  verifiedCopy: "Отключена до появления авторитетного механизма проверки.",
  visualMarker: "Визуальный маркер",
  viewLeaderboard: "Смотреть таблицу",
  viewProfile: "Открыть профиль",
};

export const translations: Readonly<Record<Locale, Readonly<Record<TranslationKey, string>>>> = {
  en: english,
  ru: russian,
};

const chassisLabels: Readonly<Record<Locale, Readonly<Record<CarChassis, string>>>> = {
  en: {
    formula: "Formula",
    rally: "Rally",
    roadster: "Roadster",
  },
  ru: {
    formula: "Формула",
    rally: "Ралли",
    roadster: "Родстер",
  },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.includes(value as Locale);
}

export function formatScore(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US").format(value);
}

export function formatCarChassis(value: CarChassis, locale: Locale): string {
  return chassisLabels[locale][value];
}

export function formatFreshness(days: number | null, locale: Locale): string {
  if (days === null) {
    return "—";
  }
  if (days === 0) {
    return locale === "ru" ? "сегодня" : "today";
  }
  if (locale === "ru") {
    return `${String(days)} ${days === 1 ? "день" : days < 5 ? "дня" : "дней"}`;
  }
  return `${String(days)} ${days === 1 ? "day" : "days"}`;
}

export function formatDayCount(days: number, locale: Locale): string {
  if (locale === "ru") {
    return `${String(days)} ${days % 10 === 1 && days % 100 !== 11 ? "день" : "дн."}`;
  }
  return `${String(days)}d`;
}

export function dayLabels(locale: Locale): readonly string[] {
  return locale === "ru"
    ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
}
