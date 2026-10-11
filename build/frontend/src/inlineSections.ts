// Inline sections for Raycast root search: Snippets and Web Search Suggestions.
// The calculator moved to the backend engine (`calculator.calculate` over IPC) — see
// docs/calculator-spec.md — so the split row and its actions live in App.tsx.

export interface InlineSectionResult {
  type: "snippet" | "web-search";
  title: string;
  subtitle: string;
  action: (query: string, closeWindow?: () => void) => void;
  keywords: string[];
  icon?: string; // SVG icon for web search engines
}

// Snippets section - user-defined text snippets
export interface Snippet {
  id: string;
  title: string;
  content: string;
  keyword?: string;
}

const DEFAULT_SNIPPETS: Snippet[] = [
  { id: "email", title: "Email Template", content: "Hi,\n\nThanks for reaching out.\n\nBest regards", keyword: "email" },
  { id: "date", title: "Current Date", content: new Date().toISOString().split("T")[0], keyword: "date" },
  { id: "lorem", title: "Lorem Ipsum", content: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.", keyword: "lorem" },
];

export function loadSnippets(): Snippet[] {
  try {
    const stored = localStorage.getItem("raycast-mini:snippets");
    if (stored) {
      return JSON.parse(stored) as Snippet[];
    }
  } catch {
    // Ignore errors
  }
  return DEFAULT_SNIPPETS;
}

export function saveSnippets(snippets: Snippet[]): void {
  try {
    localStorage.setItem("raycast-mini:snippets", JSON.stringify(snippets));
  } catch {
    // Ignore errors
  }
}

export function searchSnippets(query: string): InlineSectionResult[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [];

  const snippets = loadSnippets();
  const results: InlineSectionResult[] = [];

  for (const snippet of snippets) {
    const titleMatch = snippet.title.toLowerCase().includes(trimmed);
    const keywordMatch = snippet.keyword?.toLowerCase().includes(trimmed) ?? false;
    const contentMatch = snippet.content.toLowerCase().includes(trimmed);

    if (titleMatch || keywordMatch || contentMatch) {
      results.push({
        type: "snippet",
        title: snippet.title,
        subtitle: snippet.content.slice(0, 100) + (snippet.content.length > 100 ? "..." : ""),
        action: () => navigator.clipboard.writeText(snippet.content),
        keywords: [snippet.title.toLowerCase(), snippet.keyword?.toLowerCase() ?? "", snippet.content.toLowerCase()].filter(Boolean),
      });
    }
  }

  return results;
}

// Web search suggestions
export function searchWebSuggestions(query: string): InlineSectionResult[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 2) return [];

  const engines = [
    {
      name: "Google",
      url: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" overflow="hidden" viewBox="0 0 268.152 273.883"><defs><linearGradient id="google-a"><stop offset="0" stop-color="#0fbc5c"/><stop offset="1" stop-color="#0cba65"/></linearGradient><linearGradient id="google-g"><stop offset=".231" stop-color="#0fbc5f"/><stop offset=".312" stop-color="#0fbc5f"/><stop offset=".366" stop-color="#0fbc5e"/><stop offset=".458" stop-color="#0fbc5d"/><stop offset=".54" stop-color="#12bc58"/><stop offset=".699" stop-color="#28bf3c"/><stop offset=".771" stop-color="#38c02b"/><stop offset=".861" stop-color="#52c218"/><stop offset=".915" stop-color="#67c30f"/><stop offset="1" stop-color="#86c504"/></linearGradient><linearGradient id="google-h"><stop offset=".142" stop-color="#1abd4d"/><stop offset=".248" stop-color="#6ec30d"/><stop offset=".312" stop-color="#8ac502"/><stop offset=".366" stop-color="#a2c600"/><stop offset=".446" stop-color="#c8c903"/><stop offset=".54" stop-color="#ebcb03"/><stop offset=".616" stop-color="#f7cd07"/><stop offset=".699" stop-color="#fdcd04"/><stop offset=".771" stop-color="#fdce05"/><stop offset=".861" stop-color="#ffce0a"/></linearGradient><linearGradient id="google-f"><stop offset=".316" stop-color="#ff4c3c"/><stop offset=".604" stop-color="#ff692c"/><stop offset=".727" stop-color="#ff7825"/><stop offset=".885" stop-color="#ff8d1b"/><stop offset="1" stop-color="#ff9f13"/></linearGradient><linearGradient id="google-b"><stop offset=".231" stop-color="#ff4541"/><stop offset=".312" stop-color="#ff4540"/><stop offset=".458" stop-color="#ff4640"/><stop offset=".54" stop-color="#ff473f"/><stop offset=".699" stop-color="#ff5138"/><stop offset=".771" stop-color="#ff5b33"/><stop offset=".861" stop-color="#ff6c29"/><stop offset="1" stop-color="#ff8c18"/></linearGradient><linearGradient id="google-d"><stop offset=".408" stop-color="#fb4e5a"/><stop offset="1" stop-color="#ff4540"/></linearGradient><linearGradient id="google-c"><stop offset=".132" stop-color="#0cba65"/><stop offset=".21" stop-color="#0bb86d"/><stop offset=".297" stop-color="#09b479"/><stop offset=".396" stop-color="#08ad93"/><stop offset=".477" stop-color="#0aa6a9"/><stop offset=".568" stop-color="#0d9cc6"/><stop offset=".667" stop-color="#1893dd"/><stop offset=".769" stop-color="#258bf1"/><stop offset=".859" stop-color="#3086ff"/></linearGradient><linearGradient id="google-e"><stop offset=".366" stop-color="#ff4e3a"/><stop offset=".458" stop-color="#ff8a1b"/><stop offset=".54" stop-color="#ffa312"/><stop offset=".616" stop-color="#ffb60c"/><stop offset=".771" stop-color="#ffcd0a"/><stop offset=".861" stop-color="#fecf0a"/><stop offset=".915" stop-color="#fecf08"/><stop offset="1" stop-color="#fdcd01"/></linearGradient><linearGradient xlink:href="#a" id="google-s" x1="219.7" x2="254.467" y1="329.535" y2="329.535" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#b" id="google-m" cx="109.627" cy="135.862" r="71.46" fx="109.627" fy="135.862" gradientTransform="matrix(-1.93688 1.043 1.45573 2.55542 290.525 -400.634)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#c" id="google-n" cx="45.259" cy="279.274" r="71.46" fx="45.259" fy="279.274" gradientTransform="matrix(-3.5126 -4.45809 -1.69255 1.26062 870.8 191.554)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#d" id="google-l" cx="304.017" cy="118.009" r="47.854" fx="304.017" fy="118.009" gradientTransform="matrix(2.06435 0 0 2.59204 -297.679 -151.747)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#e" id="google-o" cx="181.001" cy="177.201" r="71.46" fx="181.001" fy="177.201" gradientTransform="matrix(-.24858 2.08314 2.96249 .33417 -255.146 -331.164)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#f" id="google-p" cx="207.673" cy="108.097" r="41.102" fx="207.673" fy="108.097" gradientTransform="matrix(-1.2492 1.34326 -3.89684 -3.4257 880.501 194.905)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#g" id="google-r" cx="109.627" cy="135.862" r="71.46" fx="109.627" fy="135.862" gradientTransform="matrix(-1.93688 -1.043 1.45573 -2.55542 290.525 838.683)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#h" id="google-j" cx="154.87" cy="145.969" r="71.46" fx="154.87" fy="145.969" gradientTransform="matrix(-.0814 -1.93722 2.92674 -.11625 -215.135 632.86)" gradientUnits="userSpaceOnUse"/><filter id="google-q" width="1.097" height="1.116" x="-.048" y="-.058" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="1.701"/></filter><filter id="google-k" width="1.033" height="1.02" x="-.017" y="-.01" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".242"/></filter><clipPath id="google-i" clipPathUnits="userSpaceOnUse"><path d="M371.378 193.24H237.083v53.438h77.167c-1.241 7.563-4.026 15.003-8.105 21.786-4.674 7.773-10.451 13.69-16.373 18.196-17.74 13.498-38.42 16.258-52.783 16.258-36.283 0-67.283-23.286-79.285-54.928-.484-1.149-.805-2.335-1.197-3.507a81.115 81.115 0 0 1-4.101-25.448c0-9.226 1.569-18.057 4.43-26.398 11.285-32.897 42.985-57.467 80.179-57.467 7.481 0 14.685.884 21.517 2.648a77.668 77.668 0 0 1 33.425 18.25l40.834-39.712c-24.839-22.616-57.219-36.32-95.844-36.32-30.878 0-59.386 9.553-82.748 25.7-18.945 13.093-34.483 30.625-44.97 50.985-9.753 18.879-15.094 39.8-15.094 62.294 0 22.495 5.35 43.633 15.103 62.337v.126c10.302 19.857 25.368 36.954 43.678 49.988 15.997 11.386 44.68 26.551 84.031 26.551 22.63 0 42.687-4.051 60.375-11.644 12.76-5.478 24.065-12.622 34.301-21.804 13.525-12.132 24.117-27.139 31.347-44.404 7.23-17.265 11.097-36.79 11.097-57.957 0-9.858-.998-19.87-2.689-28.968Z"/></clipPath></defs><g clip-path="url(#google-i)" transform="matrix(.95792 0 0 .98525 -90.174 -78.856)"><path fill="url(#google-j)" d="M92.076 219.958c.148 22.14 6.501 44.983 16.117 63.424v.127c6.949 13.392 16.445 23.97 27.26 34.452l65.327-23.67c-12.36-6.235-14.246-10.055-23.105-17.026-9.054-9.066-15.802-19.473-20.004-31.677h-.17l.17-.127c-2.765-8.058-3.037-16.613-3.14-25.503Z" filter="url(#google-k)"/><path fill="url(#google-l)" d="M237.083 79.025c-6.456 22.526-3.988 44.421 0 57.161 7.457.006 14.64.888 21.45 2.647a77.662 77.662 0 0 1 33.424 18.25l41.88-40.726c-24.81-22.59-54.667-37.297-96.754-37.332Z" filter="url(#google-k)"/><path fill="url(#google-m)" d="M236.943 78.847c-31.67 0-60.91 9.798-84.871 26.359a145.533 145.533 0 0 0-24.332 21.15c-1.904 17.744 14.257 39.551 46.262 39.37 15.528-17.936 38.495-29.542 64.056-29.542l.07.002-1.044-57.335c-.048 0-.093-.004-.14-.004Z" filter="url(#google-k)"/><path fill="url(#google-n)" d="m341.475 226.379-28.268 19.285c-1.24 7.562-4.028 15.002-8.107 21.786-4.674 7.772-10.45 13.69-16.373 18.196-17.702 13.47-38.328 16.244-52.687 16.255-14.842 25.102-17.444 37.675 1.043 57.934 22.877-.016 43.157-4.117 61.046-11.796 12.931-5.551 24.388-12.792 34.761-22.097 13.706-12.295 24.442-27.503 31.769-45 7.327-17.497 11.245-37.282 11.245-58.734Z" filter="url(#google-k)"/><path fill="#3086ff" d="M234.996 191.21v57.498h136.006c1.196-7.874 5.152-18.064 5.152-26.5 0-9.858-.996-21.899-2.687-30.998Z" filter="url(#google-k)"/><path fill="url(#google-o)" d="M128.39 124.327c-8.394 9.119-15.564 19.326-21.249 30.364-9.753 18.879-15.094 41.83-15.094 64.324 0 .317.026.627.029.944 4.32 8.224 59.666 6.649 62.456 0-.004-.31-.039-.613-.039-.924 0-9.226 1.57-16.026 4.43-24.367 3.53-10.289 9.056-19.763 16.123-27.926 1.602-2.031 5.875-6.397 7.121-9.016.475-.997-.862-1.557-.937-1.908-.083-.393-1.876-.077-2.277-.37-1.275-.929-3.8-1.414-5.334-1.845-3.277-.921-8.708-2.953-11.725-5.06-9.536-6.658-24.417-14.612-33.505-24.216Z" filter="url(#google-k)"/><path fill="url(#google-p)" d="M162.099 155.857c22.112 13.301 28.471-6.714 43.173-12.977l-25.574-52.664a144.74 144.74 0 0 0-26.543 14.504c-12.316 8.512-23.192 18.9-32.176 30.72Z" filter="url(#google-q)"/><path fill="url(#google-r)" d="M171.099 290.222c-29.683 10.641-34.33 11.023-37.062 29.29a144.806 144.806 0 0 0 16.792 13.984c15.996 11.386 46.766 26.551 86.118 26.551.046 0 .09-.004.137-.004v-59.157l-.094.002c-14.736 0-26.512-3.843-38.585-10.527-2.977-1.648-8.378 2.777-11.123.799-3.786-2.729-12.9 2.35-16.183-.938Z" filter="url(#google-k)"/><path fill="url(#google-s)" d="M219.7 299.023v59.996c5.506.64 11.236 1.028 17.247 1.028 6.026 0 11.855-.307 17.52-.872v-59.748a105.119 105.119 0 0 1-17.477 1.461c-5.932 0-11.7-.686-17.29-1.865Z" filter="url(#google-k)" opacity=".5"/></g></svg>`
    },
    {
      name: "DuckDuckGo",
      url: `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 128 128"><path fill="#DE5833" fill-rule="evenodd" d="M64 128c35.346 0 64-28.654 64-64S99.346 0 64 0 0 28.654 0 64s28.654 64 64 64" clip-rule="evenodd"/><path fill="#DDD" fill-rule="evenodd" d="M73 111.75c0-.5.123-.614-1.466-3.782-4.224-8.459-8.47-20.384-6.54-28.075.353-1.397-3.978-51.744-7.04-53.365-3.402-1.813-7.588-4.69-11.418-5.33-1.943-.31-4.49-.164-6.482.105-.353.047-.368.683-.03.798 1.308.443 2.895 1.212 3.83 2.375.178.22-.06.566-.342.577-.882.032-2.482.402-4.593 2.195-.244.207-.041.592.273.53 4.536-.897 9.17-.455 11.9 2.027.177.16.084.45-.147.512-23.694 6.44-19.003 27.05-12.696 52.344 5.619 22.53 7.733 29.792 8.4 32.004a.72.72 0 0 0 .423.467C55.228 118.38 73 118.524 73 113z" clip-rule="evenodd"/><path fill="#fff" fill-rule="evenodd" d="M122.75 64c0 32.447-26.303 58.75-58.75 58.75S5.25 96.447 5.25 64 31.553 5.25 64 5.25 122.75 31.553 122.75 64m-72.46 51.986c-1.624-5.016-6.161-19.551-10.643-37.92l-.447-1.828-.003-.016c-5.425-22.155-9.855-40.252 14.427-45.937.222-.052.33-.317.183-.492-2.786-3.305-8.005-4.388-14.604-2.111-.27.093-.506-.18-.338-.412 1.294-1.783 3.823-3.155 5.072-3.756.258-.124.242-.502-.031-.588a28 28 0 0 0-3.771-.9c-.37-.059-.404-.693-.032-.743 9.356-1.259 19.125 1.55 24.028 7.726a.33.33 0 0 0 .185.114c17.953 3.855 19.239 32.235 17.17 33.528-.407.255-1.714.108-3.438-.085-6.985-.781-20.818-2.329-9.401 18.948.113.21-.037.488-.272.525-6.416.997 1.755 21.034 7.812 34.323 23.815-5.52 41.563-26.868 41.563-52.362 0-29.685-24.065-53.75-53.75-53.75S10.25 34.315 10.25 64c0 24.947 16.995 45.924 40.04 51.986" clip-rule="evenodd"/><path fill="#3CA82B" d="M84.28 90.698c-1.367-.633-6.621 3.135-10.11 6.028-.728-1.031-2.103-1.78-5.203-1.242-2.713.472-4.211 1.126-4.88 2.254-4.283-1.623-11.488-4.13-13.229-1.71-1.902 2.646.476 15.161 3.003 16.786 1.32.849 7.63-3.208 10.926-6.005.532.749 1.388 1.178 3.148 1.137 2.662-.062 6.979-.681 7.649-1.921q.06-.113.105-.266c3.388 1.266 9.35 2.606 10.682 2.406 3.47-.521-.484-16.723-2.09-17.467"/><path fill="#4CBA3C" d="M74.49 97.097c.144.256.26.526.358.8.483 1.352 1.27 5.648.674 6.709-.595 1.062-4.459 1.574-6.843 1.615s-2.92-.831-3.403-2.181c-.387-1.081-.577-3.621-.572-5.075-.098-2.158.69-2.916 4.334-3.506 2.696-.436 4.121.071 4.944.94 3.828-2.857 10.215-6.889 10.838-6.152 3.106 3.674 3.499 12.42 2.826 15.939-.22 1.151-10.505-1.139-10.505-2.38 0-5.152-1.337-6.565-2.65-6.71M51.96 95.488c.843-1.333 7.674.325 11.424 1.993 0 0-.77 3.491.456 7.604.359 1.203-8.627 6.558-9.8 5.637-1.355-1.065-3.85-12.432-2.08-15.234"/><path fill="#FC3" fill-rule="evenodd" d="M55.269 68.407c.553-2.404 3.127-6.933 12.321-6.823 4.648-.019 10.422-.002 14.25-.436a51.312 51.312 0 0 0 12.726-3.095c3.98-1.519 5.392-1.18 5.887-.272.544.999-.097 2.722-1.488 4.309-2.656 3.03-7.431 5.38-15.865 6.076-8.433.698-14.02-1.565-16.425 2.118-1.038 1.589-.236 5.333 7.92 6.512 11.02 1.59 20.072-1.917 21.19.201s-5.323 6.428-16.362 6.518-17.934-3.865-20.379-5.83c-3.102-2.495-4.49-6.133-3.775-9.279" clip-rule="evenodd"/><g fill="#14307E" opacity=".8"><path d="M69.327 42.127c.616-1.008 1.981-1.786 4.216-1.786 2.234 0 3.285.889 4.013 1.88.148.202-.076.44-.306.34l-.168-.073c-.817-.357-1.82-.795-3.54-.82-1.838-.026-2.997.435-3.727.831-.246.134-.634-.133-.488-.372m-25.157 1.29c2.17-.907 3.876-.79 5.081-.504.254.06.43-.213.227-.377-.935-.755-3.03-1.692-5.76-.674-2.437.909-3.585 2.796-3.592 4.038-.002.292.6.317.756.07.42-.67 1.12-1.646 3.289-2.553"/><path fill-rule="evenodd" d="M75.44 55.92a3.47 3.47 0 0 1-3.474-3.462 3.47 3.47 0 0 1 3.475-3.46 3.47 3.47 0 0 1 3.474 3.46 3.47 3.47 0 0 1-3.475 3.462m2.447-4.608a.899.899 0 0 0-1.799 0c0 .494.405.895.9.895.499 0 .9-.4.9-.895m-25.465 3.542a4.04 4.04 0 0 1-4.049 4.037 4.045 4.045 0 0 1-4.05-4.037 4.045 4.045 0 0 1 4.05-4.037 4.045 4.045 0 0 1 4.05 4.037m-1.193-1.338a1.05 1.05 0 0 0-2.097 0 1.048 1.048 0 0 0 2.097 0" clip-rule="evenodd"/></g></svg>`
    },
    {
      name: "Bing",
      url: `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`,
      icon: `<svg viewBox="0 0 256 388" xmlns="http://www.w3.org/2000/svg" width="256" height="388" preserveAspectRatio="xMidYMid"><defs><radialGradient id="bing-a" cx="93.717%" cy="77.818%" r="143.121%" fx="93.717%" fy="77.818%" gradientTransform="matrix(-.65486 -.5438 .75575 -.4712 .963 1.654)"><stop offset="0%" stop-color="#00CACC"/><stop offset="100%" stop-color="#048FCE"/></radialGradient><radialGradient id="bing-b" cx="13.893%" cy="71.448%" r="150.086%" fx="13.893%" fy="71.448%" gradientTransform="matrix(.55155 -.39387 .23634 .91917 -.107 .112)"><stop offset="0%" stop-color="#00BBEC"/><stop offset="100%" stop-color="#2756A9"/></radialGradient><linearGradient id="bing-c" x1="50%" x2="50%" y1="0%" y2="100%"><stop offset="0%" stop-color="#00BBEC"/><stop offset="100%" stop-color="#2756A9"/></linearGradient></defs><path fill="url(#bing-a)" d="M129.424 122.047c-7.133.829-12.573 6.622-13.079 13.928-.218 3.147-.15 3.36 6.986 21.722 16.233 41.774 20.166 51.828 20.827 53.243 1.603 3.427 3.856 6.65 6.672 9.544 2.16 2.22 3.585 3.414 5.994 5.024 4.236 2.829 6.337 3.61 22.818 8.49 16.053 4.754 24.824 7.913 32.381 11.664 9.791 4.86 16.623 10.387 20.944 16.946 3.1 4.706 5.846 13.145 7.04 21.64.468 3.321.47 10.661.006 13.663-1.008 6.516-3.021 11.976-6.101 16.545-1.638 2.43-1.068 2.023 1.313-.939 6.74-8.379 13.605-22.7 17.108-35.687 4.24-15.718 4.817-32.596 1.66-48.57-6.147-31.108-25.786-57.955-53.444-73.06-1.738-.95-8.357-4.42-17.331-9.085-1.362-.708-3.219-1.678-4.127-2.154-.907-.477-2.764-1.447-4.126-2.154-1.362-.708-5.282-2.75-8.711-4.539l-8.528-4.446a6021.14 6021.14 0 0 1-8.344-4.357c-8.893-4.655-12.657-6.537-13.73-6.863-1.125-.343-3.984-.782-4.701-.723-.152.012-.838.088-1.527.168Z"/><path fill="url(#bing-b)" d="M148.81 277.994c-.493.292-1.184.714-1.537.938-.354.225-1.137.712-1.743 1.083a8315.383 8315.383 0 0 0-13.204 8.137 2847.83 2847.83 0 0 0-8.07 4.997 388.04 388.04 0 0 1-3.576 2.198c-.454.271-2.393 1.465-4.31 2.654a2651.466 2651.466 0 0 1-7.427 4.586 3958.037 3958.037 0 0 0-8.62 5.316 3011.146 3011.146 0 0 1-7.518 4.637c-1.564.959-3.008 1.885-3.21 2.058-.3.257-14.205 8.87-21.182 13.121-5.3 3.228-11.43 5.387-17.705 6.235-2.921.395-8.45.396-11.363.003-7.9-1.067-15.176-4.013-21.409-8.666-2.444-1.826-7.047-6.425-8.806-8.8-4.147-5.598-6.829-11.602-8.218-18.396-.32-1.564-.622-2.884-.672-2.935-.13-.13.105 2.231.528 5.319.44 3.211 1.377 7.856 2.387 11.829 7.814 30.743 30.05 55.749 60.15 67.646 8.668 3.424 17.415 5.582 26.932 6.64 3.576.4 13.699.56 17.43.276 17.117-1.296 32.02-6.334 47.308-15.996 1.362-.86 3.92-2.474 5.685-3.585a877.227 877.227 0 0 0 4.952-3.14c.958-.615 2.114-1.341 2.567-1.614a91.312 91.312 0 0 0 2.018-1.268c.656-.424 3.461-2.2 6.235-3.944l11.092-7.006 3.809-2.406.137-.086.42-.265.199-.126 2.804-1.771 9.69-6.121c12.348-7.759 16.03-10.483 21.766-16.102 2.392-2.342 5.997-6.34 6.176-6.848.037-.104.678-1.092 1.424-2.197 3.036-4.492 5.06-9.995 6.064-16.484.465-3.002.462-10.342-.005-13.663-.903-6.42-2.955-13.702-5.167-18.339-3.627-7.603-11.353-14.512-22.453-20.076-3.065-1.537-6.23-2.943-6.583-2.924-.168.009-10.497 6.322-22.954 14.03-12.457 7.71-23.268 14.4-24.025 14.87-.756.47-2.056 1.263-2.888 1.764l-7.128 4.42Z"/><path fill="url(#bing-c)" d="m.053 241.013.054 53.689.695 3.118c2.172 9.747 5.937 16.775 12.482 23.302 3.078 3.07 5.432 4.922 8.768 6.896 7.06 4.177 14.657 6.238 22.978 6.235 8.716-.005 16.256-2.179 24.025-6.928 1.311-.801 6.449-3.964 11.416-7.029l9.032-5.572v-127.4l-.002-58.273c-.002-37.177-.07-59.256-.188-60.988-.74-10.885-5.293-20.892-12.948-28.461-2.349-2.323-4.356-3.875-10.336-7.99-2.976-2.048-8.423-5.799-12.104-8.336A186532.885 186532.885 0 0 0 28.617 5.835C22.838 1.85 22.386 1.574 20.639.949 18.367.136 15.959-.163 13.67.084 6.998.804 1.657 5.622.269 12.171.053 13.191.013 26.751.01 100.35l-.003 86.975H0l.053 53.688Z"/></svg>`
    },
    {
      name: "GitHub",
      url: `https://github.com/search?q=${encodeURIComponent(trimmed)}`,
      icon: `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" fill="none"><path fill="#1b1f23" fill-rule="evenodd" d="M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0" clip-rule="evenodd"/></svg>`
    },
    {
      name: "Stack Overflow",
      url: `https://stackoverflow.com/search?q=${encodeURIComponent(trimmed)}`,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 169.61 200" width="2120" height="2500"><path d="M140.44 178.38v-48.65h21.61V200H0v-70.27h21.61v48.65z" fill="#bcbbbb"/><path d="M124.24 140.54l4.32-16.22-86.97-17.83-3.78 17.83zM49.7 82.16L130.72 120l7.56-16.22-81.02-37.83zm22.68-40l68.06 57.3 11.35-13.51-68.6-57.3-11.35 13.51zM116.14 0l-14.59 10.81 53.48 71.89 14.58-10.81zM37.81 162.16h86.43v-16.21H37.81z" fill="#f48024"/></svg>`
    },
  ];

  return engines.map((engine) => ({
    type: "web-search",
    title: `Search ${engine.name} for "${trimmed}"`,
    subtitle: engine.url,
    action: () => window.open(engine.url, "_blank", "noopener"),
    keywords: [engine.name.toLowerCase(), "search", "web"].filter(Boolean),
    icon: engine.icon,
  }));
}

// Get all inline section results for a query (the calculator evaluates over IPC in App.tsx)
export function getInlineSectionResults(query: string): InlineSectionResult[] {
  const results: InlineSectionResult[] = [];

  // Snippets
  results.push(...searchSnippets(query));

  // Web search suggestions (lowest priority)
  results.push(...searchWebSuggestions(query));

  return results;
}

// Settings for inline sections
export interface InlineSectionSettings {
  calculator: boolean;
  translate: boolean;
  snippets: boolean;
  webSearch: boolean;
}

export const DEFAULT_INLINE_SECTION_SETTINGS: InlineSectionSettings = {
  calculator: true,
  translate: true,
  snippets: true,
  webSearch: true,
};

export function loadInlineSectionSettings(): InlineSectionSettings {
  try {
    const stored = localStorage.getItem("raycast-mini:inline-section-settings");
    if (stored) {
      return { ...DEFAULT_INLINE_SECTION_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore errors
  }
  return DEFAULT_INLINE_SECTION_SETTINGS;
}

export function saveInlineSectionSettings(settings: InlineSectionSettings): void {
  try {
    localStorage.setItem("raycast-mini:inline-section-settings", JSON.stringify(settings));
  } catch {
    // Ignore errors
  }
}
