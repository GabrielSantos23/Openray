// The Window Management command catalog — titles, descriptions, keywords and argument shapes
// exactly as shipped (`internal-extensions-C7AXi5Nw.js`). Standalone so the Settings page catalog
// can import it without dragging in the IPC layer.

export interface WmCommandDefinition {
  key: string;
  title: string;
  description: string;
  keywords: string[];
  args?: Array<{ name: "width" | "height" | "position"; placeholder: string }>;
}

const P = (key: string, title: string, description: string, keywords: string[] = [], args?: WmCommandDefinition["args"]): WmCommandDefinition => ({
  key,
  title,
  description,
  keywords,
  args,
});

export const WM_COMMANDS: WmCommandDefinition[] = [
  P("maximize", "Maximize", "Maximize focused window to fit the screen."),
  P("restore", "Restore", "Restore focused window to its last position."),
  P("minimize", "Minimize", "Minimize focused window to the taskbar.", ["hide", "taskbar", "dock"]),
  P("minimizeOnDisplay", "Minimize on This Display", "Minimize all windows on the display where Openray is open.", ["show desktop", "minimize all", "hide", "monitor", "screen"]),
  P("maximizeHeight", "Maximize Height", "Maximize height of focused window to fit the screen."),
  P("maximizeWidth", "Maximize Width", "Maximize width of focused window to fit the screen."),
  P("maximizeAlmost", "Almost Maximize", "Maximize focused window to almost fit the screen."),
  P("reasonableSize", "Reasonable Size", "Resize focused window to 60% of the screen (Maximum: 1024x900)."),
  P("resizeWindow", "Resize Window", "Resize focused window to an exact width and height.", ["exact", "size", "dimensions", "resolution", "pixels", "1920x1080"], [
    { name: "width", placeholder: "Width" },
    { name: "height", placeholder: "Height" },
  ]),
  P("center", "Center", "Center focused window in screen."),
  P("centerHalf", "Center Half", "Resize focused window to the half of the screen and center."),
  P("leftHalf", "Left Half", "Resize focused window to the left half of the screen."),
  P("rightHalf", "Right Half", "Resize focused window to the right half of the screen."),
  P("topHalf", "Top Half", "Resize focused window to the top half of the screen."),
  P("bottomHalf", "Bottom Half", "Resize focused window to the bottom half of the screen."),
  P("firstThird", "First Third", "Resize focused window to the first third of the screen.", ["left"]),
  P("centerThird", "Center Third", "Resize focused window to the center third of the screen."),
  P("lastThird", "Last Third", "Resize focused window to the last third of the screen.", ["right"]),
  P("firstTwoThird", "First Two Thirds", "Resize focused window to the first two thirds of the screen.", ["left"]),
  P("centerTwoThird", "Center Two Thirds", "Resize focused window to the center two thirds of the screen."),
  P("lastTwoThird", "Last Two Thirds", "Resize focused window to the last two thirds of the screen.", ["right"]),
  P("firstThreeFourth", "First Three Fourths", "Resize focused window to the first three fourths of the screen.", ["left"]),
  P("centerThreeFourth", "Center Three Fourths", "Resize focused window to the center three fourths of the screen."),
  P("lastThreeFourth", "Last Three Fourths", "Resize focused window to the last three fourths of the screen.", ["right"]),
  P("topThird", "Top Third", "Resize focused window to the top third of the screen."),
  P("middleThird", "Middle Third", "Resize focused window to the vertical middle third of the screen."),
  P("bottomThird", "Bottom Third", "Resize focused window to the bottom third of the screen."),
  P("topTwoThird", "Top Two Thirds", "Resize focused window to the top two thirds of the screen."),
  P("bottomTwoThird", "Bottom Two Thirds", "Resize focused window to the bottom two thirds of the screen."),
  P("topFirstFourth", "Top First Fourth", "Resize focused window to the top first fourth of the screen."),
  P("topSecondFourth", "Top Second Fourth", "Resize focused window to the top second fourth of the screen."),
  P("topThirdFourth", "Top Third Fourth", "Resize focused window to the top third fourth of the screen."),
  P("topLastFourth", "Top Last Fourth", "Resize focused window to the top last fourth of the screen."),
  P("topThreeFourth", "Top Three Fourths", "Resize focused window to the top three fourths of the screen."),
  P("bottomThreeFourth", "Bottom Three Fourths", "Resize focused window to the bottom three fourths of the screen."),
  P("topCenterTwoThird", "Top Center Two Thirds", "Resize focused window to the top center two thirds of the screen."),
  P("bottomCenterTwoThird", "Bottom Center Two Thirds", "Resize focused window to the bottom center two thirds of the screen."),
  P("firstFourth", "First Fourth", "Resize focused window to the first fourth of the screen.", ["left"]),
  P("secondFourth", "Second Fourth", "Resize focused window to the second fourth of the screen."),
  P("thirdFourth", "Third Fourth", "Resize focused window to the third fourth of the screen."),
  P("lastFourth", "Last Fourth", "Resize focused window to the last fourth of the screen.", ["right"]),
  P("topLeftQuarter", "Top Left Quarter", "Resize focused window to the top left quarter of the screen."),
  P("topRightQuarter", "Top Right Quarter", "Resize focused window to the top right quarter of the screen."),
  P("bottomLeftQuarter", "Bottom Left Quarter", "Resize focused window to the bottom left quarter of the screen."),
  P("bottomRightQuarter", "Bottom Right Quarter", "Resize focused window to the bottom right quarter of the screen."),
  P("topLeftSixth", "Top Left Sixth", "Resize focused window to the top left sixth of the screen."),
  P("topCenterSixth", "Top Center Sixth", "Resize focused window to the top center sixth of the screen."),
  P("topRightSixth", "Top Right Sixth", "Resize focused window to the top right sixth of the screen."),
  P("bottomLeftSixth", "Bottom Left Sixth", "Resize focused window to the bottom left sixth of the screen."),
  P("bottomCenterSixth", "Bottom Center Sixth", "Resize focused window to the bottom center sixth of the screen."),
  P("bottomRightSixth", "Bottom Right Sixth", "Resize focused window to the bottom right sixth of the screen."),
  P("moveLeft", "Move Left", "Move focused window to the left edge of the screen."),
  P("moveRight", "Move Right", "Move focused window to the right edge of the screen."),
  P("moveTop", "Move Top", "Move focused window to the top edge of the screen.", ["up"]),
  P("moveBottom", "Move Bottom", "Move focused window to the bottom edge of the screen.", ["down"]),
  P("moveWindow", "Move Window", "Move focused window to exact coordinates on its display.", ["exact", "position", "coordinates", "pixels", "place"], [
    { name: "position", placeholder: "100,100" },
  ]),
  P("makeSmaller", "Make Smaller", "Decrease the focused window until it reaches 25% of the screen."),
  P("makeLarger", "Make Larger", "Increase the focused window until it reaches the screen size."),
  P("movePreviousDisplay", "Move to Previous Display", "Move focused window to the previous display.", ["desktop"]),
  P("moveNextDisplay", "Move to Next Display", "Move focused window to the next display.", ["desktop"]),
  P("toggleAlwaysOnTop", "Toggle Always on Top", "Pin the focused window above all other windows.", ["pin", "topmost", "always on top", "stay on top"]),
  P("focusNextAppWindow", "Focus Next App Window", "Focus the next window of the app you are using. Press repeatedly to cycle through all of its windows.", ["cycle", "switch", "same app", "next window", "app windows", "foreground"]),
  P("focusPreviousAppWindow", "Focus Previous App Window", "Focus the previous window of the app you are using. Press repeatedly to cycle through all of its windows.", ["cycle", "switch", "same app", "previous window", "app windows", "foreground"]),
];

export function wmCommandDefinition(key: string): WmCommandDefinition | undefined {
  return WM_COMMANDS.find((definition) => definition.key === key);
}

/** Root-row icon for a command (registry names; move edges get their direction arrow). */
export function wmCommandIcon(commandKey: string): string {
  switch (commandKey) {
    case "moveLeft":
      return "ArrowLeft";
    case "moveRight":
      return "ArrowRight";
    case "moveTop":
      return "ArrowUp";
    case "moveBottom":
      return "ArrowDown";
    case "toggleAlwaysOnTop":
      return "tack";
    default:
      return "Window";
  }
}
