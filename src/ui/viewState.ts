export function setElementVisible(
  element: HTMLElement | null | undefined,
  visible: boolean,
  displayValue = "block",
): void {
  if (!element) {
    return;
  }

  element.hidden = !visible;
  element.style.display = visible ? displayValue : "none";
}

function waitForNextPaint(frames = 1): Promise<void> {
  return new Promise<void>((resolve) => {
    const totalFrames = Math.max(0, Math.floor(frames));
    let remainingFrames = totalFrames;

    const step = () => {
      if (remainingFrames <= 0) {
        resolve();
        return;
      }
      remainingFrames -= 1;
      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  });
}

export function createTransitionController() {
  let token = 0;
  return {
    begin(): number {
      token += 1;
      return token;
    },
    isActive(activeToken: number): boolean {
      return activeToken === token;
    },
  };
}

export async function waitForNextPaintIfActive(
  transitionController: { isActive: (activeToken: number) => boolean },
  activeToken: number,
  frames = 1,
): Promise<boolean> {
  await waitForNextPaint(frames);
  return transitionController.isActive(activeToken);
}
