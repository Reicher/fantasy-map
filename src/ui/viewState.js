export function setElementVisible(element, visible, displayValue = "block") {
  if (!element) {
    return;
  }

  element.hidden = !visible;
  element.style.display = visible ? displayValue : "none";
}

function waitForNextPaint(frames = 1) {
  return new Promise((resolve) => {
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
    begin() {
      token += 1;
      return token;
    },
    isActive(activeToken) {
      return activeToken === token;
    },
  };
}

export async function waitForNextPaintIfActive(
  transitionController,
  activeToken,
  frames = 1,
) {
  await waitForNextPaint(frames);
  return transitionController.isActive(activeToken);
}
