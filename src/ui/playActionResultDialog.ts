import { setElementVisible } from "./viewState";
import type { PlayState } from "@fardvag/shared/types/play";

interface ActionResultDialogRefs {
  dialog: HTMLElement | null | undefined;
  body: HTMLElement | null | undefined;
}

export interface ActionResultDialogRenderState {
  visible: boolean | null;
  message: string | null;
}

export function syncActionResultDialog(
  refs: ActionResultDialogRefs,
  playState: PlayState | null | undefined,
  isPlay: boolean,
  previousState: ActionResultDialogRenderState,
): ActionResultDialogRenderState {
  const dialog = refs.dialog;
  const body = refs.body;
  if (!dialog || !body) {
    return previousState;
  }

  const resultMessage =
    playState?.latestHuntFeedback?.type === "result"
      ? String(playState.latestHuntFeedback.text ?? "")
      : "";
  const hasBlockingInteraction = Boolean(playState?.pendingJourneyEvent);
  const shouldShow = isPlay && resultMessage.length > 0 && !hasBlockingInteraction;
  let nextVisible = previousState.visible;
  let nextMessage = previousState.message;

  if (nextVisible !== shouldShow) {
    setElementVisible(dialog, shouldShow, "grid");
    nextVisible = shouldShow;
  }
  if (!shouldShow) {
    nextMessage = null;
  } else if (resultMessage !== nextMessage) {
    body.textContent = resultMessage;
    nextMessage = resultMessage;
  }

  return {
    visible: nextVisible,
    message: nextMessage,
  };
}

export function hideActionResultDialog(
  refs: ActionResultDialogRefs,
): ActionResultDialogRenderState {
  if (refs.dialog) {
    setElementVisible(refs.dialog, false, "grid");
  }
  return {
    visible: false,
    message: null,
  };
}
