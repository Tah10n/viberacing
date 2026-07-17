import type { Locale } from "./i18n";

const english = {
  approve: "Approve this device",
  approvedCopy: "The connector may now finish activation. You can close this page.",
  approvedTitle: "Device approved",
  approving: "Checking your passkey…",
  architecture: "Architecture",
  backToAccount: "Back to account",
  backToRace: "Back to the race",
  brand: "Vibe Racing",
  codeHint: "Enter the 12-symbol code shown by the connector, including both hyphens.",
  codeLabel: "Pairing code",
  connector: "Connector version",
  copy: "Review the exact local connector before giving it access to submit self-reported Community activity for one new source.",
  device: "Device",
  error: "The code or approval could not be completed. Check the details or try again later.",
  expires: "Expires",
  fingerprint: "Public-key fingerprint",
  language: "Language",
  noRelease:
    "No public connector release is available yet. Use only a build whose checksum, platform signature, and provenance you have independently verified.",
  platform: "Platform",
  reviewCopy:
    "Approve only if every value matches the connector on your device. A fresh passkey check authorizes this exact pending key for one new source.",
  reviewTitle: "Review this device",
  searching: "Checking code…",
  signedOut: "Sign in with your passkey before approving a device.",
  signIn: "Sign in",
  stepCode: "The connector displays a short pairing code and its own key fingerprint.",
  stepReview: "This page shows the same device, version, platform, expiry, and fingerprint.",
  stepVerify:
    "A fresh passkey approval authorizes only that pending key; the connector must still prove possession to activate it.",
  submitCode: "Review device",
  title: "Connect a device",
  unsupported: "This browser or device does not support WebAuthn passkeys.",
} as const;

type ConnectTranslationKey = keyof typeof english;

const russian: Record<ConnectTranslationKey, string> = {
  approve: "Подтвердить устройство",
  approvedCopy: "Теперь коннектор может завершить активацию. Эту страницу можно закрыть.",
  approvedTitle: "Устройство подтверждено",
  approving: "Проверяем ключ доступа…",
  architecture: "Архитектура",
  backToAccount: "Вернуться в аккаунт",
  backToRace: "Вернуться к гонке",
  brand: "Vibe Racing",
  codeHint: "Введите 12-символьный код из коннектора вместе с двумя дефисами.",
  codeLabel: "Код подключения",
  connector: "Версия коннектора",
  copy: "Проверьте локальный коннектор перед тем, как разрешить ему отправлять заявленную активность сообщества для одного нового источника.",
  device: "Устройство",
  error:
    "Не удалось проверить код или подтвердить устройство. Сверьте данные или попробуйте позже.",
  expires: "Истекает",
  fingerprint: "Отпечаток публичного ключа",
  language: "Язык",
  noRelease:
    "Публичного релиза коннектора пока нет. Используйте только сборку, для которой вы независимо проверили контрольную сумму, подпись платформы и происхождение.",
  platform: "Платформа",
  reviewCopy:
    "Подтверждайте, только если все значения совпадают с коннектором на вашем устройстве. Свежая проверка ключом доступа разрешит ровно этот ожидающий ключ для одного нового источника.",
  reviewTitle: "Проверьте устройство",
  searching: "Проверяем код…",
  signedOut: "Войдите с ключом доступа, прежде чем подтверждать устройство.",
  signIn: "Войти",
  stepCode: "Коннектор показывает короткий код подключения и отпечаток своего ключа.",
  stepReview: "Эта страница показывает то же устройство, версию, платформу, срок и отпечаток.",
  stepVerify:
    "Свежая проверка ключом доступа разрешит только этот ожидающий ключ; для активации коннектору ещё нужно доказать владение им.",
  submitCode: "Проверить устройство",
  title: "Подключить устройство",
  unsupported: "Этот браузер или устройство не поддерживает ключи доступа WebAuthn.",
};

export const connectTranslations: Record<
  Locale,
  Record<ConnectTranslationKey, string>
> = Object.freeze({
  en: Object.freeze(english),
  ru: Object.freeze(russian),
});
