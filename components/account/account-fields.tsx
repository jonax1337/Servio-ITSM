"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ComboField } from "@/components/combo-field";
import type { ComboOption } from "@/components/combobox";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { useServerMessage, useT } from "@/lib/i18n/client";
import { AUTO_LOCALE, LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/config";
import { EMAIL_NOTIFICATION_CATEGORIES, type EmailNotificationPrefs } from "@/lib/notification-email-rules";

export type AccountUser = {
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
  department: string;
  timezone: string;
  locale: string;
  /** The instance default the "auto" choice follows. */
  instanceLocale: Locale;
  signature: string;
  signatureEnabled: boolean;
  /** Staff (agent and above) see the Notifications section. */
  isStaff: boolean;
  emailNotifications: EmailNotificationPrefs;
};

export type FieldErrors = Record<string, string[] | undefined>;

export function Field({
  label,
  error,
  children,
  hint,
  htmlFor,
}: {
  label: string;
  error?: string[];
  children: React.ReactNode;
  hint?: string;
  htmlFor?: string;
}) {
  const tm = useServerMessage();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{tm(error[0])}</p> : null}
    </div>
  );
}

const TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Warsaw",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function ProfileFields({
  user,
  fe,
}: {
  user: AccountUser;
  fe: FieldErrors;
}) {
  const t = useT("account");
  return (
    <div className="grid gap-5">
      <Field label={t("name")} error={fe.name} htmlFor="acc-name">
        <Input id="acc-name" name="name" defaultValue={user.name} required />
      </Field>

      <Field label={t("email")} hint={t("emailHint")}>
        <Input value={user.email} disabled readOnly />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("phone")} error={fe.phone} htmlFor="acc-phone">
          <Input id="acc-phone" name="phone" defaultValue={user.phone} />
        </Field>
        <Field label={t("jobTitle")} error={fe.jobTitle} htmlFor="acc-job">
          <Input id="acc-job" name="jobTitle" defaultValue={user.jobTitle} />
        </Field>
      </div>

      <Field label={t("department")} error={fe.department} htmlFor="acc-dept">
        <Input id="acc-dept" name="department" defaultValue={user.department} />
      </Field>
    </div>
  );
}

export function PreferencesFields({ user }: { user: AccountUser }) {
  const t = useT("account");
  const tzOpts: ComboOption[] = TIMEZONES.map((tz) => ({ value: tz, label: tz }));
  const tzDefault = TIMEZONES.includes(user.timezone) ? user.timezone : "UTC";
  // "auto" follows the instance default; anything unsupported (legacy values) is shown as auto.
  const localeOpts: ComboOption[] = [
    { value: AUTO_LOCALE, label: t("languageAuto", { language: LOCALE_NAMES[user.instanceLocale] }) },
    ...LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] })),
  ];
  const localeDefault = (LOCALES as readonly string[]).includes(user.locale) ? user.locale : AUTO_LOCALE;

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label={t("timezone")}>
        <ComboField name="timezone" defaultValue={tzDefault} options={tzOpts} />
      </Field>
      <Field label={t("language")} hint={t("languageHint")}>
        <ComboField name="locale" defaultValue={localeDefault} options={localeOpts} />
      </Field>
    </div>
  );
}

export function NotificationFields({ user }: { user: AccountUser }) {
  const t = useT("account");
  return (
    <div className="grid gap-4">
      <input type="hidden" name="emailNotificationsForm" value="1" />
      {EMAIL_NOTIFICATION_CATEGORIES.map((category) => (
        <label key={category} className="flex items-start justify-between gap-4">
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">{t(`notify.${category}.label`)}</span>
            <span className="text-xs text-muted-foreground">{t(`notify.${category}.hint`)}</span>
          </span>
          <Switch name={`emailNotify.${category}`} defaultChecked={user.emailNotifications[category]} />
        </label>
      ))}
    </div>
  );
}

export function SignatureFields({ user }: { user: AccountUser }) {
  const t = useT("account");
  return (
    <div className="grid gap-4">
      <label className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">{t("autoAppendSignature")}</span>
        <Switch name="signatureEnabled" defaultChecked={user.signatureEnabled} />
      </label>
      <RichTextEditor
        name="signature"
        defaultHTML={user.signature}
        ariaLabel={t("signatureAria")}
        placeholder={t("signaturePlaceholder")}
      />
      <p className="text-xs text-muted-foreground">
        {t("signatureHint")}
      </p>
    </div>
  );
}
