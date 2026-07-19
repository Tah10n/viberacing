import type { Metadata } from "next";

import { ConnectExperience } from "@/components/connect-experience";
import { readEnrollmentPageConnect } from "@/lib/enrollment-page-session";
import { resolveSourceCreationConfig } from "@/lib/source-creation-config";

export const metadata: Metadata = {
  description: "Review and approve one Vibe Racing connector device with a passkey.",
  title: "Connect a device | Vibe Racing",
};

const sourceCreationConfig = resolveSourceCreationConfig();

export default async function ConnectPage() {
  const connect = await readEnrollmentPageConnect();
  const existingSources =
    connect?.activeDeviceInventory === undefined
      ? undefined
      : Object.freeze(
          connect.activeDeviceInventory.flatMap((source, sourceIndex) =>
            source.state === "active"
              ? [
                  Object.freeze({
                    deviceLabels: Object.freeze(source.devices.map((device) => device.label)),
                    sourceControl: source.sourceControl,
                    sourceNumber: sourceIndex + 1,
                  }),
                ]
              : [],
          ),
        );
  return (
    <ConnectExperience
      {...(existingSources === undefined ? {} : { existingSources })}
      initialLocale={connect?.session.locale ?? "en"}
      signedIn={connect?.session.passkeyRegistered === true}
      sourceCreationEnabled={sourceCreationConfig.enabled}
    />
  );
}
