import type { CarChassis } from "./car-recipe";

export const locales = ["en", "ru"] as const;
export type Locale = (typeof locales)[number];

const english = {
  account: "Account",
  brand: "Vibe Racing",
  car: "Car",
  change: "Change",
  coder: "Coder",
  communityDetail: "Community · self-reported by connected devices",
  communityDataBadge: "Community · self-reported",
  communityDataSecurityNote:
    "Public snapshots contain only a handle, exact weekly total, rank, rounded freshness, optional approved car, and opt-in provider percentages.",
  communityNotice: "Community leaderboard",
  communityProfile: "Community profile",
  communityProfilePrivacy:
    "Account labels, device details, exact sync times, and daily totals stay private.",
  communityWeek: "Current Community week",
  continueWithGithub: "Continue with GitHub",
  dataControl: "Data control",
  fallbackBadge: "Synthetic fallback",
  freshness: "Freshness",
  heroCopy:
    "Vibe Racing adds provider-reported tokens from connected accounts of supported coding agents. No model, price, or subscription multipliers.",
  heroTitle: "All your coding agents. Every account. One GitHub profile.",
  howRankingWorks: "How ranking works",
  language: "Language",
  leaderboard: "Leaderboard",
  liveRace: "Weekly race",
  methodology: "Ranking method",
  motion: "Motion",
  motionOff: "Reduced",
  motionOn: "On",
  motionSystem: "Device setting",
  noGlobalClaim:
    "This community vibecode rating covers Vibe Racing participants only — never every coding-agent user.",
  noParticipants: "No Community participants yet.",
  noApprovedCar: "No approved public car yet.",
  pauseRace: "Pause race",
  primaryNavigation: "Primary navigation",
  privacyByDefault: "Privacy by default",
  profile: "Profile",
  profileNotFound: "This public profile is not present in the current snapshot.",
  profileUnavailable: "The public profile summary is temporarily unavailable.",
  providerBreakdown: "Provider mix",
  rank: "Rank",
  rankMovementUnavailable: "Not available in this snapshot",
  raceAlternative: "Race standings",
  raceLoading: "Race visual loads after the semantic leaderboard.",
  resumeRace: "Resume race",
  sharedRank: "Shared rank",
  signIn: "Sign in",
  theme: "Theme",
  themeClassic: "Classic Grand Prix",
  themeCyber: "Cyber Rally",
  themeNeon: "Neon Night Arcade",
  tokenMethodologyCopy:
    "Rank is the exact sum of accepted provider-reported weekly totals across connected agent accounts. Ties share a rank. There are no model, price, subscription, account-count, or device-count multipliers.",
  tokenQualityDisclaimer:
    "This measures token usage, not code quality. Tokenizers differ between agents.",
  tokens: "tokens",
  unavailable: "Unavailable",
  verified: "Verified league",
  verifiedCopy: "Disabled until an authoritative verification boundary exists.",
  viewLeaderboard: "View standings",
  viewProfile: "View profile",
  weeklyTokens: "Weekly tokens",
} as const;

export type TranslationKey = keyof typeof english;

const russian: Record<TranslationKey, string> = {
  account: "Аккаунт",
  brand: "Vibe Racing",
  car: "Машина",
  change: "Изменение",
  coder: "Разработчик",
  communityDetail: "Community · данные заявлены подключёнными устройствами",
  communityDataBadge: "Community · данные участников",
  communityDataSecurityNote:
    "Публичный snapshot содержит только handle, точную недельную сумму, ранг, округлённую свежесть, опциональную подтверждённую машину и открытые проценты providers.",
  communityNotice: "Рейтинг сообщества",
  communityProfile: "Профиль сообщества",
  communityProfilePrivacy:
    "Названия аккаунтов, данные устройств, точное время синхронизации и дневные суммы остаются приватными.",
  communityWeek: "Текущая неделя сообщества",
  continueWithGithub: "Продолжить с GitHub",
  dataControl: "Управление данными",
  fallbackBadge: "Синтетический резерв",
  freshness: "Обновление",
  heroCopy:
    "Vibe Racing складывает provider-reported tokens из подключённых аккаунтов поддерживаемых coding agents. Без коэффициентов по модели, цене или подписке.",
  heroTitle: "Все ваши coding agents. Все аккаунты. Один GitHub-профиль.",
  howRankingWorks: "Как считается рейтинг",
  language: "Язык",
  leaderboard: "Таблица лидеров",
  liveRace: "Недельная гонка",
  methodology: "Как считается рейтинг",
  motion: "Анимация",
  motionOff: "Снижена",
  motionOn: "Включена",
  motionSystem: "Как на устройстве",
  noGlobalClaim:
    "Этот community vibecode rating охватывает только участников Vibe Racing, а не всех пользователей coding agents.",
  noParticipants: "В рейтинге сообщества пока нет участников.",
  noApprovedCar: "Подтверждённой публичной машины пока нет.",
  pauseRace: "Остановить гонку",
  primaryNavigation: "Основная навигация",
  privacyByDefault: "Приватность по умолчанию",
  profile: "Профиль",
  profileNotFound: "Этого публичного профиля нет в текущем snapshot.",
  profileUnavailable: "Публичная сводка профиля временно недоступна.",
  providerBreakdown: "Распределение по providers",
  rank: "Место",
  rankMovementUnavailable: "Нет в этом snapshot",
  raceAlternative: "Позиции в гонке",
  raceLoading: "Визуальная гонка загружается после основной таблицы.",
  resumeRace: "Продолжить гонку",
  sharedRank: "Общее место",
  signIn: "Войти",
  theme: "Тема",
  themeClassic: "Классический гран-при",
  themeCyber: "Кибер-ралли",
  themeNeon: "Неоновая аркада",
  tokenMethodologyCopy:
    "Место определяет точная сумма принятых provider-reported недельных итогов всех подключённых agent accounts. Равные суммы делят место. Коэффициентов по модели, цене, подписке, числу аккаунтов или устройств нет.",
  tokenQualityDisclaimer:
    "Это рейтинг количества токенов, а не качества кода. Токенизаторы разных агентов отличаются.",
  tokens: "токенов",
  unavailable: "Недоступно",
  verified: "Проверенная лига",
  verifiedCopy: "Отключена до появления авторитетного механизма проверки.",
  viewLeaderboard: "Смотреть таблицу",
  viewProfile: "Открыть профиль",
  weeklyTokens: "Токены за неделю",
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

export function formatExactTokenTotal(value: string, locale: Locale): string {
  if (!/^(?:0|[1-9][0-9]{0,59})$/.test(value)) {
    throw new RangeError("token total must be one canonical non-negative decimal");
  }
  const separator = locale === "ru" ? "\u00a0" : ",";
  const firstGroupLength = value.length % 3 || 3;
  const groups = [value.slice(0, firstGroupLength)];
  for (let index = firstGroupLength; index < value.length; index += 3) {
    groups.push(value.slice(index, index + 3));
  }
  return groups.join(separator);
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
