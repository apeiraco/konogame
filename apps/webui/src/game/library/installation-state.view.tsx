import { useWebUIService } from "../../app/use-webui-service.ts";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";
import { InstallationState } from "./library.model.ts";

const stateMessageKeys = {
  [InstallationState.Available]: "library:stateAvailable",
  [InstallationState.Unavailable]: "library:stateUnavailable",
  [InstallationState.Unverified]: "library:stateUnverified",
  [InstallationState.None]: "library:stateNone"
} as const;

/** Text plus a shaped marker, so the state never depends on colour alone. */
export function InstallationStatePill({ state }: { readonly state: InstallationState }) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  return (
    <span className="kg-state" data-state={state}>
      <span className="kg-state-mark" aria-hidden="true" />
      {t(stateMessageKeys[state])}
    </span>
  );
}
