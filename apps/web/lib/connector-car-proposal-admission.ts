import "server-only";

const maximumAdmissionLimit = 32;

export class ConnectorCarProposalAdmissionConfigurationError extends Error {
  constructor() {
    super("Connector car proposal admission configuration is invalid.");
    this.name = "ConnectorCarProposalAdmissionConfigurationError";
  }
}

export interface ConnectorCarProposalAdmissionLease {
  release(): void;
}

export interface ConnectorCarProposalAdmission {
  tryAcquire(): ConnectorCarProposalAdmissionLease | undefined;
}

export function createConnectorCarProposalAdmission(limit: number): ConnectorCarProposalAdmission {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumAdmissionLimit) {
    throw new ConnectorCarProposalAdmissionConfigurationError();
  }
  let active = 0;
  return Object.freeze({
    tryAcquire(): ConnectorCarProposalAdmissionLease | undefined {
      if (active >= limit) {
        return undefined;
      }
      active += 1;
      let released = false;
      return Object.freeze({
        release(): void {
          if (!released) {
            released = true;
            active -= 1;
          }
        },
      });
    },
  });
}
