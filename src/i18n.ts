// Minimal built-in i18n: English is the default; Korean is picked up from the
// system language, and either can be forced in Settings. Parameterized strings
// are functions so TypeScript checks their call sites. Adding a language =
// adding one more dictionary object.

import { loadLang } from "./settings";
import type { SortKey } from "./types";

const en = {
  // Sidebar / navigation
  navAll: "All Files",
  navRecent: "Recent",
  navFavorites: "Favorites",
  sectionFolders: "Folders",
  sectionTags: "Tags",
  addFolderTip: "Add folder",
  addRemoteFolderTip: "Add remote folder (SSH)",
  noFolders: "No folders yet",
  removeFolderTip: "Remove folder",

  // Toolbar
  fileCount: (n: number) => (n === 1 ? "1 file" : `${n} files`),
  searchPlaceholder: "Search names & full text…",
  clear: "Clear",
  sortTip: "Sort by",
  sortAscTip: "Ascending (click for descending)",
  sortDescTip: "Descending (click for ascending)",
  gridViewTip: "Grid view",
  listViewTip: "List view",
  rescanTip: "Rescan registered folders",
  scanning: "Scanning…",
  refresh: "Refresh",
  openFileTip: "Open an HTML/Markdown file",
  openFile: "Open File",
  sortLabels: {
    modified: "Modified",
    name: "Name",
    size: "Size",
    created: "Created",
    opened: "Last opened",
  } as Record<SortKey, string>,

  // Views / titles
  titleFolder: "Folder",
  editTags: "Edit Tags",

  // Onboarding / empty states
  onboardingTitle: "Your library is empty",
  onboardingBody:
    "Register a folder where your agent outputs pile up — its HTML and Markdown files are scanned into a browsable, searchable, thumbnailed library, and new files show up automatically.",
  onboardingAddFolder: "Add Folder",
  onboardingOpenFile: "Open a File",
  emptySearch: "No results.",
  emptyList: "No files to show.",

  // Cards / list rows
  favoriteTip: "Favorite",
  unfavoriteTip: "Unfavorite",
  missingBadge: "missing",
  cardNeedsAuth: "Authentication required — open to enter the password",
  cardNotFound: "File not found",
  removeFromLibrary: "Remove from library",
  forgetTip: "Remove from library (never deletes the file)",

  // Confirms (never delete originals)
  confirmForget: (name: string) =>
    `Remove '${name}' from the library?\n(The original file will not be deleted)`,
  confirmRemoveFolder: (name: string) =>
    `Remove the folder '${name}' from the list?\n(The original files will not be deleted)`,

  // Viewer
  back: "Back",
  findTip: "Find in document (⌘/Ctrl+F)",
  find: "Find",
  editTagsTip: "Edit tags",
  tags: "Tags",
  remove: "Remove",
  openInBrowserTip: "Open in browser",
  openInBrowser: "Browser ↗",
  findPlaceholder: "Find in document…",
  findPrevTip: "Previous (Shift+Enter)",
  findNextTip: "Next (Enter)",
  findCloseTip: "Close (Esc)",
  viewerAuthTitle: "Authentication required",
  viewerNotFoundTitle: "File not found",
  viewerErrorTitle: "Could not load the file",
  // Rendered after a <strong>hostkey</strong> prefix.
  viewerAuthBody:
    " requires a password to connect. It is kept only while the app is running and never stored.",
  viewerNotFoundBody:
    "The file could not be loaded from this location — it may have been moved, renamed, or deleted. If you locate it again, re-register it with Open File.",
  viewerErrorBody:
    "The file exists but its content could not be displayed. Try again, or open it in your browser.",
  enterPassword: "Enter Password",
  retry: "Retry",
  tryInBrowser: "Try opening in browser",

  // Tag editor
  removeTagTip: "Remove",
  tagPlaceholder: "+ tag",

  // Remote folder modal
  remoteModalTitle: "🌐 Add Remote Folder (SSH)",
  remoteModalSub: "Register a folder of HTML/Markdown files over SFTP",
  remoteTarget: "Connection",
  remoteTargetPlaceholder: "user@host, user@host:port, or an ~/.ssh/config alias",
  remotePath: "Remote path",
  remotePathHint: "Subfolders are suggested — Tab to complete, ↑↓ to choose",
  remoteAuth: "Authentication",
  authAuto: "Auto (agent & default keys)",
  authKey: "Key file (.pem)",
  authPassword: "Password",
  chooseKeyFile: "Choose key file…",
  passwordPlaceholder: "Kept only while the app runs — never stored",
  remoteNeedsPassword: "This server requires a password. Enter it and try again.",
  cancel: "Cancel",
  connecting: "Connecting…",
  add: "Add",

  // Password modal
  passwordModalTitle: "🔒 SSH Password",
  ok: "OK",

  // Settings
  settings: "Settings",
  settingsLanguage: "Language",
  langAuto: "Auto (system language)",
  settingsTheme: "Theme",
  themeAuto: "Auto (system)",
  themeLight: "Light",
  themeDark: "Dark",
  settingsReloadHint: "Changes apply when you press OK (the window reloads).",

  // Native dialog filters
  filterSshKeys: "SSH keys",
  filterAllFiles: "All files",
  filterDocuments: "Documents",

  // Relative times
  justNow: "just now",
  minutesAgo: (n: number) => `${n}m ago`,
  hoursAgo: (n: number) => `${n}h ago`,
  daysAgo: (n: number) => `${n}d ago`,
};

type Dict = typeof en;

const ko: Dict = {
  navAll: "전체",
  navRecent: "최근 본 파일",
  navFavorites: "즐겨찾기",
  sectionFolders: "폴더",
  sectionTags: "태그",
  addFolderTip: "폴더 추가",
  addRemoteFolderTip: "원격 폴더 추가 (SSH)",
  noFolders: "등록된 폴더 없음",
  removeFolderTip: "폴더 제거",

  fileCount: (n: number) => `${n}개`,
  searchPlaceholder: "파일명 · 내용 전문 검색…",
  clear: "지우기",
  sortTip: "정렬 기준",
  sortAscTip: "오름차순 (누르면 내림차순)",
  sortDescTip: "내림차순 (누르면 오름차순)",
  gridViewTip: "그리드 보기",
  listViewTip: "목록 보기",
  rescanTip: "등록 폴더 다시 스캔",
  scanning: "스캔 중…",
  refresh: "새로고침",
  openFileTip: "HTML/Markdown 파일 열기",
  openFile: "파일 열기",
  sortLabels: {
    modified: "수정일",
    name: "이름",
    size: "크기",
    created: "생성일",
    opened: "열어본 날짜",
  } as Record<SortKey, string>,

  titleFolder: "폴더",
  editTags: "태그 편집",

  onboardingTitle: "라이브러리가 비어 있어요",
  onboardingBody:
    "에이전트 결과물이 쌓이는 폴더를 등록하면 HTML·Markdown 파일을 스캔해 목록·검색·썸네일을 만들고, 새 파일은 자동으로 나타납니다.",
  onboardingAddFolder: "폴더 추가",
  onboardingOpenFile: "파일 하나 열기",
  emptySearch: "검색 결과가 없습니다.",
  emptyList: "표시할 파일이 없습니다.",

  favoriteTip: "즐겨찾기",
  unfavoriteTip: "즐겨찾기 해제",
  missingBadge: "없음",
  cardNeedsAuth: "인증 필요 — 열면 비밀번호를 물어봅니다",
  cardNotFound: "파일을 찾을 수 없음",
  removeFromLibrary: "라이브러리에서 제거",
  forgetTip: "라이브러리에서 제거 (원본 파일은 삭제되지 않음)",

  confirmForget: (name: string) =>
    `'${name}'을(를) 라이브러리에서 제거할까요?\n(원본 파일은 삭제되지 않습니다)`,
  confirmRemoveFolder: (name: string) =>
    `'${name}' 폴더를 목록에서 제거할까요?\n(원본 파일은 삭제되지 않습니다)`,

  back: "뒤로",
  findTip: "문서 내 검색 (⌘/Ctrl+F)",
  find: "찾기",
  editTagsTip: "태그 편집",
  tags: "태그",
  remove: "제거",
  openInBrowserTip: "브라우저로 열기",
  openInBrowser: "브라우저로 ↗",
  findPlaceholder: "문서 내 검색…",
  findPrevTip: "이전 (Shift+Enter)",
  findNextTip: "다음 (Enter)",
  findCloseTip: "닫기 (Esc)",
  viewerAuthTitle: "인증이 필요합니다",
  viewerNotFoundTitle: "파일을 찾을 수 없습니다",
  viewerErrorTitle: "파일을 불러오지 못했습니다",
  viewerAuthBody:
    " 서버에 접속하려면 비밀번호가 필요합니다. 비밀번호는 앱 실행 중에만 기억되며 저장되지 않습니다.",
  viewerNotFoundBody:
    "이 위치에서 파일을 불러오지 못했어요. 이동·이름변경·삭제되었을 수 있습니다. 원본을 다시 찾았다면 파일 열기로 다시 등록하세요.",
  viewerErrorBody:
    "파일은 존재하지만 내용을 표시하지 못했어요. 다시 열거나 브라우저로 열어 보세요.",
  enterPassword: "비밀번호 입력",
  retry: "다시 시도",
  tryInBrowser: "브라우저로 열기 시도",

  removeTagTip: "제거",
  tagPlaceholder: "+ 태그",

  remoteModalTitle: "🌐 원격 폴더 추가 (SSH)",
  remoteModalSub: "서버의 HTML·Markdown 폴더를 SFTP로 등록합니다",
  remoteTarget: "접속 대상",
  remoteTargetPlaceholder: "user@host, user@host:포트 또는 ~/.ssh/config 별칭",
  remotePath: "원격 경로",
  remotePathHint: "하위 폴더가 제안됩니다 — Tab 완성, ↑↓ 선택",
  remoteAuth: "인증",
  authAuto: "자동 (에이전트·기본 키)",
  authKey: "키 파일 (.pem)",
  authPassword: "비밀번호",
  chooseKeyFile: "키 파일 선택…",
  passwordPlaceholder: "앱 실행 중에만 기억되며 저장되지 않습니다",
  remoteNeedsPassword: "이 서버는 비밀번호가 필요합니다. 입력 후 다시 시도하세요.",
  cancel: "취소",
  connecting: "접속 중…",
  add: "추가",

  passwordModalTitle: "🔒 SSH 비밀번호",
  ok: "확인",

  settings: "설정",
  settingsLanguage: "언어",
  langAuto: "자동 (시스템 언어)",
  settingsTheme: "테마",
  themeAuto: "자동 (시스템)",
  themeLight: "라이트",
  themeDark: "다크",
  settingsReloadHint: "확인을 누르면 적용됩니다 (창이 새로고침됩니다).",

  filterSshKeys: "SSH 키",
  filterAllFiles: "모든 파일",
  filterDocuments: "문서",

  justNow: "방금 전",
  minutesAgo: (n: number) => `${n}분 전`,
  hoursAgo: (n: number) => `${n}시간 전`,
  daysAgo: (n: number) => `${n}일 전`,
};

const langSetting = loadLang();

export const locale: "en" | "ko" =
  langSetting !== "auto"
    ? langSetting
    : typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ko")
      ? "ko"
      : "en";

const dict: Dict = locale === "ko" ? ko : en;

/** Look up a UI string (or string-producing function) for the active locale. */
export function t<K extends keyof Dict>(key: K): Dict[K] {
  return dict[key];
}
