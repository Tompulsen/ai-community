import { getClientConfig } from "../config/client";
import { SubmitKey } from "../store/config";
import { LocaleType } from "./index";
import { SAAS_CHAT_UTM_URL } from "@/app/constant";
// if you are adding a new translation, please use PartialLocaleType instead of LocaleType

const isApp = !!getClientConfig()?.isApp;
const en: LocaleType = {
  Navigation: {
    Tagline: "Your personal AI assistant",
    Gallery: "Gallery",
    Video: "Video",
  },
  Account: {
    Title: "Account & Keys",
    LoginTitle: "Sign in to Octopus",
    PreviewOnly: "Local preview. Account details will not be submitted.",
    UsernamePlaceholder: "Enter your username",
    PasswordPlaceholder: "Enter your password",
    ShowPassword: "Show password",
    HidePassword: "Hide password",
    NoAccount: "New to Octopus?",
    Username: "Username",
    UserId: "Account ID",
    Password: "Password",
    Login: "Sign In",
    LoggingIn: "Signing in...",
    Logout: "Sign Out",
    Register: "Create Account",
    ResetPassword: "Reset Password",
    TwoFactorCode: "Two-factor code or recovery code",
    BackToLogin: "Back to Sign In",
    PasswordLoginDisabled:
      "Password sign-in is disabled. Contact the administrator for access.",
    NotConfigured:
      "Account access has not been configured. Contact the administrator.",
    RequestFailed: "The request failed. Please try again.",
    ChallengeFailed:
      "Security verification is unavailable. Retry or contact the administrator.",
    ChallengeLoading: "Loading security verification...",
    ChallengeTimedOut: "Security verification timed out. Please reload it.",
    ChallengeExpired: "Security verification expired. Please verify again.",
    RetryChallenge: "Reload Verification",
    ChallengeRequired: "Complete security verification first.",
    Balance: "Account Balance",
    UsedQuota: "Used Quota",
    RequestCount: "Total Requests",
    RefreshBalance: "Refresh Account Balance",
    Topup: "Top Up & Plans",
    ManageAccount: "Manage Account",
    MyTokens: "My API Keys",
    QuotaUsage: "Quota / Usage",
    TokenActions: "Actions",
    MoreTokenActions: "More key actions",
    StartChat: "Start Chat",
    RefreshTokens: "Refresh API Keys",
    CreateToken: "Create Key",
    EditToken: "Edit Key",
    DeleteToken: "Delete Key",
    EnableToken: "Enable Key",
    DisableToken: "Disable Key",
    TokenName: "Key Name",
    TokenNamePlaceholder: "Chat / Cursor / Personal testing",
    Group: "Group",
    GroupMode: "Request Routing",
    InheritGroup: "Account Group",
    SystemDefault: "System",
    SystemDefaultHint:
      "Uses the Octopus Admin automatic group list. Changes apply automatically.",
    SingleGroup: "Single Group",
    MultiGroup: "Custom Groups",
    InheritGroupHint: (group: string) =>
      `Inherits your account's user group (${group}).`,
    InheritedGroup: (group: string) => `User group · Inherited (${group})`,
    MultiGroupAvailable: (max: number) =>
      `Octopus Admin group routing is available. Select up to ${max} groups.`,
    MultiGroupUnsupported:
      "Octopus Admin does not currently support group routing.",
    MultiGroupNotEnabled:
      "Multiple groups are not enabled for this account. Contact the administrator.",
    SearchGroups: "Search available groups",
    UseDefaultGroups: "Use the server's default group list",
    DefaultGroupsHint: (groups: string) =>
      `Use the Octopus Admin default group list: ${groups}. Changes apply automatically.`,
    DefaultGroupsManaged: "Managed by the server",
    GroupUnavailable:
      "This group is unavailable. Remove it and choose another.",
    NoMatchingGroups: "No matching groups available",
    MoveGroupUp: (name: string) => `Move ${name} up`,
    MoveGroupDown: (name: string) => `Move ${name} down`,
    SelectedGroupCount: (count: number, max: number) =>
      `${count} / ${max} groups selected, ordered from top to bottom.`,
    InvalidAutoGroups: (max: number) =>
      `Select 1 to ${max} available groups, or keep the server's default list.`,
    MultiGroupRoutingHint:
      "Models with the same name appear once. Octopus Admin selects a group using your group order and its routing rules. Choose a single group for a fixed route.",
    CrossGroupRetryPreserved:
      "Cross-group retry is enabled for this key and will be preserved.",
    AutoRatio: "Automatic rate",
    RemainingQuota: "Remaining Quota",
    UnlimitedQuota: "No key quota limit",
    TokenQuotaHint:
      "The key quota is a usage limit. Keys without a quota limit still charge your account balance.",
    Unlimited: "Unlimited",
    Expiry: "Expires",
    Never: "Never",
    KeepExpiry: (expiry: string) => `Keep current expiry: ${expiry}`,
    ExpireInDays: (days: number) => `In ${days} days`,
    LimitModels: "Restrict models",
    AllowedModels: "Allowed Models",
    ModelsPlaceholder: "Full model names, separated by commas or new lines",
    InvalidToken: "Check the key name, group, quota, and model restrictions.",
    Save: "Save",
    Saving: "Saving...",
    Enabled: "Enabled",
    Disabled: "Disabled",
    Expired: "Expired",
    Exhausted: "Quota exhausted",
    Unavailable: "Unavailable",
    Selected: "Used for Chat",
    UseForChat: "Use for Chat",
    CurrentToken: (name: string) => `Current chat key: ${name}`,
    SelectTokenHint:
      "No chat key selected. Choose an existing key for chat or create a new one.",
    NoAvailableModel:
      "The selected model is unavailable for this key. Check its group or choose another model.",
    FirstTokenHint:
      'Create a chat key with Auto routing or a group of your choice. After saving, click "Use for Chat".',
    NoTokens: "No API keys yet",
    DeleteConfirm: (name: string) =>
      `Delete the key "${name}"? Applications using it will lose access.`,
    Usage: "Usage History",
    RefreshUsage: "Refresh Usage History",
    NoLogs: "No usage history yet.",
    Time: "Time",
    Model: "Model",
    InputOutput: "Input / Output Tokens",
    Cost: "Cost",
    PreviousPage: "Previous Page",
    NextPage: "Next Page",
    PageCount: (page: number, pages: number, total: number) =>
      `Page ${page} / ${pages}, ${total} total`,
  },
  WIP: "Coming Soon...",
  Error: {
    Unauthorized: isApp
      ? `😆 Oops, there's an issue. No worries:
     \\ 1️⃣ New here? [Click to start chatting now 🚀](${SAAS_CHAT_UTM_URL})
     \ 2️⃣ Want to use your own OpenAI resources? [Click here](/#/settings) to change settings ⚙️`
      : `😆 Oops, there's an issue. Let's fix it:
     \ 1️⃣ New here? [Click to start chatting now 🚀](${SAAS_CHAT_UTM_URL})
     \ 2️⃣ Using a private setup? [Click here](/#/auth) to enter your key 🔑
     \ 3️⃣ Want to use your own OpenAI resources? [Click here](/#/settings) to change settings ⚙️
     `,
    Title: "Something went wrong",
    Details: "View error details",
    Description: "The application encountered an error",
    Report: "Report Error",
    ClearData: "Clear All Data",
    ClearConfirm:
      "Are you sure you want to clear all chat history and settings? This action cannot be undone.",
    Retry: "Retry",
    Offline:
      "Network connection lost. Please check your network and try again.",
    NetworkError: "Network request failed. Please try again later.",
    Timeout: "Request timed out. Please check your network or try again later.",
    ServerError: "Server error. Please try again later.",
    RateLimit: "Too many requests. Please try again later.",
  },
  Auth: {
    Return: "Return",
    Title: "Need Access Code",
    Tips: "Please enter access code below",
    SubTips: "Or enter your OpenAI or Google API Key",
    Input: "access code",
    Confirm: "Confirm",
    Later: "Later",
    SaasTips: "Too Complex, Use Immediately Now",
    TopTips:
      "🥳 章鱼公益平台 launch promotion: Instantly unlock the latest models like OpenAI o1, GPT-4o, Claude-3.5!",
  },
  ChatItem: {
    ChatItemCount: (count: number) => `${count} messages`,
    Favorite: "Favorite Selected",
    Unfavorite: "Unfavorite Selected",
    SelectAll: "Select All",
    DeselectAll: "Deselect All",
    SelectedCount: (count: number) => `${count} selected`,
    SelectChat: (title: string) => `Select chat: ${title}`,
    DeleteSelected: "Delete Selected",
    DeleteConfirm: (count: number) => `Delete the ${count} selected chats?`,
  },
  Chat: {
    CodeBlock: {
      Expand: "Expand all",
      Collapse: "Collapse code",
      Lines: (count: number) => `${count} lines`,
    },
    Activity: {
      thinking: "Thinking",
      researching: "Browsing the web",
      writing: "Writing",
      done: "Done",
      error: "Failed",
      Sources: (count: number) => `${count} sources`,
    },
    SubTitle: (count: number) => `${count} messages`,
    EditMessage: {
      Title: "Edit All Messages",
      Topic: {
        Title: "Topic",
        SubTitle: "Change the current topic",
      },
    },
    Actions: {
      ChatList: "Go To Chat List",
      CompressedHistory: "Compressed History Memory Prompt",
      Export: "Export All Messages as Markdown",
      Copy: "Copy",
      Stop: "Stop",
      Retry: "Retry",
      Reuse: "Reuse Input",
      ReuseConfirm:
        "Replace the current draft with this message's text and attachments?",
      Pin: "Pin",
      PinToastContent: "Pinned 1 messages to contextual prompts",
      PinToastAction: "View",
      Delete: "Delete",
      Edit: "Edit",
      FullScreen: "FullScreen",
      ExitFullScreen: "Exit Full Screen",
      RefreshTitle: "Refresh Title",
      RefreshToast: "Title refresh request sent",
      Announcement: "Announcement",
      Speech: "Play",
      StopSpeech: "Stop",
    },
    Commands: {
      new: "Start a new chat",
      newm: "Start a new chat with mask",
      next: "Next Chat",
      prev: "Previous Chat",
      clear: "Clear Context",
      fork: "Copy Chat",
      del: "Delete Chat",
    },
    InputActions: {
      Stop: "Stop",
      ToBottom: "Scroll to Bottom",
      Theme: {
        auto: "Auto",
        light: "Light Theme",
        dark: "Dark Theme",
      },
      Prompt: "Prompts",
      Masks: "Masks",
      Clear: "Clear Context",
      Settings: "Settings",
      ChatSettings: "Chat Settings",
      More: "More",
      MoreTitle: "More chat actions",
      UploadFile: "Upload Materials",
      MaterialsProcessing: "Materials are still processing. Please wait.",
      PreparingMaterials: "Preparing materials before contacting the model",
      MaterialsReady: "Materials ready",
      MaterialsFailed: "Request not sent. Check the materials or retry.",
      MaterialProcessing: "Processing",
      MaterialReady: "Ready",
      MaterialFailed: "Failed",
      RetryMaterials: "Retry materials",
      CancelMaterials: "Cancel request",
      MaterialsInterrupted:
        "Material processing was interrupted. Please select the files again.",
      RemoveMaterial: (name: string) => `Remove ${name}`,
      ImageLimit: "You can attach up to 5 images",
      ImageLoadFailed: "Failed to process image. Please select it again.",
      LoadedImages: (count: number) => `Uploaded ${count} images`,
      UnsupportedFile: (name: string) => `Unsupported file type: ${name}`,
      FileLoadFailed: "Failed to load file",
      LoadedFiles: (count: number) => `Loaded ${count} files`,
      UploadImage: "Upload Images",
    },
    Rename: "Rename Chat",
    Typing: "Typing…",
    InputPlaceholder: "Message…",
    Input: (submitKey: string) => {
      var inputHints = `${submitKey} to send`;
      if (submitKey === String(SubmitKey.Enter)) {
        inputHints += ", Shift + Enter to wrap";
      }
      return inputHints + ", / to search prompts, : to use commands";
    },
    Send: "Send",
    StartSpeak: "Start Speak",
    StopSpeak: "Stop Speak",
    Config: {
      Reset: "Reset to Default",
      SaveAs: "Save as Mask",
    },
    IsContext: "Contextual Prompt",
    ShortcutKey: {
      Title: "Keyboard Shortcuts",
      newChat: "Open New Chat",
      focusInput: "Focus Input Field",
      copyLastMessage: "Copy Last Reply",
      copyLastCode: "Copy Last Code Block",
      showShortcutKey: "Show Shortcuts",
      clearContext: "Clear Context",
    },
  },
  Export: {
    Title: "Export Messages",
    Copy: "Copy All",
    Download: "Download",
    MessageFromYou: "Message From You",
    MessageFromChatGPT: "Message From ChatGPT",
    Share: "Share to ShareGPT",
    Format: {
      Title: "Export Format",
      SubTitle: "Markdown or PNG Image",
    },
    IncludeContext: {
      Title: "Including Context",
      SubTitle: "Export context prompts in mask or not",
    },
    Steps: {
      Select: "Select",
      Preview: "Preview",
    },
    Image: {
      Toast: "Capturing Image...",
      Modal: "Long press or right click to save image",
    },
    Artifacts: {
      Title: "Share Artifacts",
      Reload: "Reload Preview",
      Error: "Share Error",
    },
  },
  Select: {
    Search: "Search",
    All: "Select All",
    Latest: "Select Latest",
    Clear: "Clear",
  },
  Memory: {
    Title: "Memory Prompt",
    EmptyContent: "Nothing yet.",
    Send: "Send Memory",
    Copy: "Copy Memory",
    Reset: "Reset Session",
    ResetConfirm:
      "Resetting will clear the current conversation history and historical memory. Are you sure you want to reset?",
  },
  Home: {
    NewChat: "New Chat",
    DeleteChat: "Confirm to delete the selected conversation?",
    DeleteToast: "Chat Deleted",
    Revert: "Revert",
  },
  Settings: {
    Title: "Settings",
    SubTitle: "All Settings",
    BackToChat: "Back to Chat",
    General: "General",
    Sections: {
      Navigation: "Settings categories",
      ModelGeneration: "Models & Generation",
      DataBackup: "Data & Backup",
      Appearance: "Appearance",
      InputReading: "Input & Reading",
      Conversation: "Chat Preferences",
      About: "About",
      ImageGeneration: "Image Generation",
      ResetClear: "Reset & Clear",
    },
    ModelConfig: "Model Settings",
    ModelSource: {
      Title: "Group",
      DefaultGroup: "Account Group",
      Choose: "Choose a group",
      Manage: "Manage keys",
      Loading: "Loading groups",
      Switching: "Preparing group",
      Pending:
        "A generation task is still running. Switch groups or keys after it finishes.",
      ModelsFailed: "Could not load this key's models. Please retry.",
      ModelsLoading: "Checking models available to the current key",
      Retry: "Retry",
      SignIn: "Sign in on the account page first.",
    },
    ChatApiFormat: {
      Title: "Chat API Format",
      SubTitle:
        "Your provider must support this API. File support depends on the API and model.",
    },
    ShowPassword: "ShowPassword",
    Danger: {
      Reset: {
        Title: "Reset All Settings",
        SubTitle: "Reset all setting items to default",
        Action: "Reset",
        Confirm: "Confirm to reset all settings to default?",
      },
      Clear: {
        Title: "Clear Current Local Data",
        SubTitle:
          "Clear this workspace's chats, gallery and drafts; keep display settings",
        Action: "Clear",
        Confirm:
          "Clear this workspace's chats, gallery, drafts and task records? Other accounts and display settings will be kept.",
      },
    },
    Lang: {
      Name: "Language", // ATTENTION: if you wanna add a new translation, please do not translate this value, leave it as `Language`
      All: "All Languages",
    },
    Avatar: "Avatar",
    FontSize: {
      Title: "Font Size",
      SubTitle: "Adjust font size of chat content",
    },
    FontFamily: {
      Title: "Chat Font Family",
      SubTitle:
        "Font Family of the chat content, leave empty to apply global default font",
      Placeholder: "Font Family Name",
    },
    InjectSystemPrompts: {
      Title: "Inject System Prompts",
      SubTitle: "Inject a global system prompt for every request",
    },
    InputTemplate: {
      Title: "Input Template",
      SubTitle: "Newest message will be filled to this template",
    },

    Update: {
      Version: (x: string) => `Version: ${x}`,
      IsLatest: "Latest version",
      CheckUpdate: "Check Update",
      IsChecking: "Checking update...",
      FoundUpdate: (x: string) => `Found new version: ${x}`,
      GoToUpdate: "Update",
      Success: "Update Successful.",
      Failed: "Update Failed.",
    },
    SendKey: "Send Key",
    Theme: "Theme",
    ColorTheme: "Color Skin",
    ColorThemeCurrent: "Current",
    ColorThemeNames: {
      blue: "Apple Blue",
      indigo: "Indigo",
      sky: "Sky Blue",
      cyan: "Neon Cyan",
      teal: "Ocean Teal",
      emerald: "Emerald",
      green: "Forest Green",
      lime: "Lime",
      amber: "Amber",
      orange: "Orange",
      coral: "Coral",
      red: "Red",
      rose: "Rose",
      pink: "Cherry Pink",
      fuchsia: "Fuchsia",
      violet: "Violet",
      graphite: "Graphite",
      slate: "Slate",
      yellow: "Yellow",
      purple: "Purple",
      stone: "Stone",
    },
    ModelPicker: {
      Placeholder: "Select a model",
      NotSelected: "Not selected",
      Title: "Select Model",
      CompressTitle: "Select Summary Model",
      Tags: {
        chat: "Chat",
        video: "Video",
        voice: "Audio",
        code: "Code",
        image: "Image",
        embed: "Embedding",
        tts: "Speech",
        asr: "Recognition",
      },
      Descriptions: {
        chat: "Questions, writing, and text tasks",
        video: "Video generation and creation",
        voice: "Voice and audio processing",
        code: "Code generation, explanation, and debugging",
        image: "Image generation and creation",
        embed: "Text embeddings and semantic search",
        tts: "Convert text into speech",
        asr: "Transcribe speech into text",
        custom: "Custom model; see your provider's capability details",
        agnes:
          "Agnes AI · Coding, reasoning, tool use, and image understanding",
        "tavily-quick": "Quick web search with page summaries and source links",
        "tavily-deep":
          "Deep web search with more detailed summaries and source links",
      },
      All: "All",
      Favorites: "Favorites",
      Favorite: "Favorite",
      Unfavorite: "Remove favorite",
      Favorited: "Added to favorites",
      Unfavorited: "Removed from favorites",
      Other: "Other",
      Search: "Search models",
      ClearSearch: "Clear search",
      ResultCount: (count: number) => `${count} models`,
      Empty: "No matching models",
      Selected: "Selected",
    },
    Provider: {
      Title: "Model Provider",
      Source: "Custom models",
      Account: "Account key · current group",
      Server: "Site default",
      Custom: "Custom provider",
      Name: "Configuration name",
      NamePlaceholder: "My provider",
      Type: "Provider type",
      Compatible: "compatible",
      Endpoint: "API endpoint",
      Models: "Fetch models",
      Apply: "Save and apply",
      Refresh: "Refresh models",
      Refreshing: "Refreshing models",
      Saved: "Configuration saved",
      HideKey: "Hide API key",
      ShowKey: "Show API key",
      KeyRequired: "Enter an API key for the custom provider",
      Invalid: "Invalid provider configuration",
      LocalHint:
        "Saved in this browser. Separate models with commas or newlines. The provider must allow browser CORS requests.",
      ResponsesHint:
        "Responses image generation requires a chat model supporting the image generation tool. Saved in this browser.",
    },
    CustomKey: {
      Title: "Custom API Key",
      Active: "Using a custom API key",
      ServerFallback: "Uses the server key when left empty",
      ServerMissing: "No server key configured. Please enter a key",
      Optional: "Leave empty to use the server key",
      Required: "Enter an API key",
      RefreshTitle: "Fetch the available model list again",
      Refresh: "Refresh Models",
      MissingTitle: "Model key not configured",
      MissingDescription:
        "The administrator has not configured a model key. Chat is unavailable",
      Missing: "Not configured",
    },
    ReduceMotion: "Reduce Motion",
    Motion: "Motion",
    MotionSystem: "System",
    MotionFull: "Full",
    MotionReduced: "Reduced",
    ShowGridBackground: "Show Grid Background",
    TightBorder: "Tight Border",
    SendPreviewBubble: {
      Title: "Send Preview Bubble",
      SubTitle: "Preview markdown in bubble",
    },
    AutoGenerateTitle: {
      Title: "Auto Generate Title",
      SubTitle: "Generate a suitable title based on the conversation content",
    },
    Sync: {
      CloudState: "Last Update",
      NotSyncYet: "Not sync yet",
      Success: "Sync Success",
      Fail: "Sync Fail",

      Config: {
        Modal: {
          Title: "Config Sync",
          Check: "Check Connection",
        },
        SyncType: {
          Title: "Sync Type",
          SubTitle: "Choose your favorite sync service",
        },
        Proxy: {
          Title: "Enable CORS Proxy",
          SubTitle: "Enable a proxy to avoid cross-origin restrictions",
        },
        ProxyUrl: {
          Title: "Proxy Endpoint",
          SubTitle:
            "Only applicable to the built-in CORS proxy for this project",
        },

        WebDav: {
          Endpoint: "WebDAV Endpoint",
          UserName: "User Name",
          Password: "Password",
        },

        UpStash: {
          Endpoint: "UpStash Redis REST Url",
          UserName: "Backup Name",
          Password: "UpStash Redis REST Token",
        },
      },

      LocalState: "Local Data",
      Overview: (overview: any) => {
        return `${overview.chat} chats，${overview.message} messages，${overview.prompt} prompts，${overview.mask} masks`;
      },
      ImportFailed: "Failed to import from file",
    },
    Mask: {
      Splash: {
        Title: "Mask Splash Screen",
        SubTitle: "Show a mask splash screen before starting new chat",
      },
      Builtin: {
        Title: "Hide Builtin Masks",
        SubTitle: "Hide builtin masks in mask list",
      },
    },
    Prompt: {
      Disable: {
        Title: "Disable auto-completion",
        SubTitle: "Type / at the start of your message to show enabled prompts",
      },
      List: "Prompt List",
      ListCount: (builtin: number, custom: number) =>
        `${builtin} built-in, ${custom} user-defined`,
      Edit: "Edit",
      Enable: (title: string) => `Enable prompt: ${title}`,
      EnabledCount: (count: number) => `, ${count} enabled`,
      NoneEnabled: "No prompts enabled yet",
      OpenSettings: "Open settings to enable prompts",
      Modal: {
        Title: "Prompt List",
        Add: "Add One",
        Search: "Search Prompts",
        DefaultTitle: "New Prompt",
        DefaultContent: "Enter prompt content",
      },
      EditModal: {
        Title: "Edit Prompt",
      },
    },
    HistoryCount: {
      Title: "History Message Count",
      SubTitle: "Number of history messages to include in each request",
    },
    ConfigBackup: {
      Title: "Config Backup",
      SubTitle: "Export or import all settings data",
      Export: "Export Config",
      Import: "Import Config",
      ExportSuccess: "Config exported successfully",
      ImportSuccess: "Config imported successfully",
      ImportError: "Import failed, please check file format",
      ConfirmImport: "Import will overwrite current config, continue?",
    },
    CompressThreshold: {
      Title: "History Compression Threshold",
      SubTitle:
        "Will compress if uncompressed messages length exceeds the value",
    },

    Usage: {
      Title: "Account Balance",
      SubTitle(used: any, total: any) {
        return `Used this month $${used}, subscription $${total}`;
      },
      IsChecking: "Checking...",
      Check: "Check",
      NoAccess: "Enter API Key to check balance",
    },
    Access: {
      SaasStart: {
        Title: "Use 章鱼公益平台",
        Label: " (Most Cost-Effective Option)",
        SubTitle:
          "Maintained by 章鱼公益平台, zero setup needed, unlock OpenAI o1, GPT-4o," +
          " Claude-3.5 and more",
        ChatNow: "Start Now",
      },
      AccessCode: {
        Title: "Access Code",
        SubTitle: "Access control Enabled",
        Placeholder: "Enter Code",
      },
      CustomEndpoint: {
        Title: "Custom Endpoint",
        SubTitle: "Use custom Azure or OpenAI service",
      },
      Provider: {
        Title: "Model Provider",
        SubTitle: "Select Azure or OpenAI",
      },
      OpenAI: {
        ApiKey: {
          Title: "OpenAI API Key",
          SubTitle: "User custom OpenAI Api Key",
          Placeholder: "sk-xxx",
        },

        Endpoint: {
          Title: "OpenAI Endpoint",
          SubTitle: "Must start with http(s):// or use /v1 as default",
        },
      },
      Azure: {
        ApiKey: {
          Title: "Azure Api Key",
          SubTitle: "Check your api key from Azure console",
          Placeholder: "Azure Api Key",
        },

        Endpoint: {
          Title: "Azure Endpoint",
          SubTitle: "Example: ",
        },

        ApiVerion: {
          Title: "Azure Api Version",
          SubTitle: "Check your api version from azure console",
        },
      },
      Anthropic: {
        ApiKey: {
          Title: "Anthropic API Key",
          SubTitle:
            "Use a custom Anthropic Key to bypass password access restrictions",
          Placeholder: "Anthropic API Key",
        },

        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "Example: ",
        },

        ApiVerion: {
          Title: "API Version (claude api version)",
          SubTitle: "Select and input a specific API version",
        },
      },
      Baidu: {
        ApiKey: {
          Title: "Baidu API Key",
          SubTitle: "Use a custom Baidu API Key",
          Placeholder: "Baidu API Key",
        },
        SecretKey: {
          Title: "Baidu Secret Key",
          SubTitle: "Use a custom Baidu Secret Key",
          Placeholder: "Baidu Secret Key",
        },
        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "not supported, configure in .env",
        },
      },
      Tencent: {
        ApiKey: {
          Title: "Tencent API Key",
          SubTitle: "Use a custom Tencent API Key",
          Placeholder: "Tencent API Key",
        },
        SecretKey: {
          Title: "Tencent Secret Key",
          SubTitle: "Use a custom Tencent Secret Key",
          Placeholder: "Tencent Secret Key",
        },
        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "not supported, configure in .env",
        },
      },
      ByteDance: {
        ApiKey: {
          Title: "ByteDance API Key",
          SubTitle: "Use a custom ByteDance API Key",
          Placeholder: "ByteDance API Key",
        },
        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "Example: ",
        },
      },
      Alibaba: {
        ApiKey: {
          Title: "Alibaba API Key",
          SubTitle: "Use a custom Alibaba Cloud API Key",
          Placeholder: "Alibaba Cloud API Key",
        },
        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "Example: ",
        },
      },
      Moonshot: {
        ApiKey: {
          Title: "Moonshot API Key",
          SubTitle: "Use a custom Moonshot API Key",
          Placeholder: "Moonshot API Key",
        },
        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "Example: ",
        },
      },
      DeepSeek: {
        ApiKey: {
          Title: "DeepSeek API Key",
          SubTitle: "Use a custom DeepSeek API Key",
          Placeholder: "DeepSeek API Key",
        },
        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "Example: ",
        },
      },
      XAI: {
        ApiKey: {
          Title: "XAI API Key",
          SubTitle: "Use a custom XAI API Key",
          Placeholder: "XAI API Key",
        },
        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "Example: ",
        },
      },
      ChatGLM: {
        ApiKey: {
          Title: "ChatGLM API Key",
          SubTitle: "Use a custom ChatGLM API Key",
          Placeholder: "ChatGLM API Key",
        },
        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "Example: ",
        },
      },
      SiliconFlow: {
        ApiKey: {
          Title: "SiliconFlow API Key",
          SubTitle: "Use a custom SiliconFlow API Key",
          Placeholder: "SiliconFlow API Key",
        },
        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "Example: ",
        },
      },
      Iflytek: {
        ApiKey: {
          Title: "Iflytek API Key",
          SubTitle: "Use a Iflytek API Key",
          Placeholder: "Iflytek API Key",
        },
        ApiSecret: {
          Title: "Iflytek API Secret",
          SubTitle: "Use a Iflytek API Secret",
          Placeholder: "Iflytek API Secret",
        },
        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "Example: ",
        },
      },
      CustomModel: {
        Title: "Custom Models",
        SubTitle: "Custom model options, seperated by comma",
      },
      Google: {
        ApiKey: {
          Title: "API Key",
          SubTitle: "Obtain your API Key from Google AI",
          Placeholder: "Google AI API Key",
        },

        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "Example: ",
        },

        ApiVersion: {
          Title: "API Version (specific to gemini-pro)",
          SubTitle: "Select a specific API version",
        },
        GoogleSafetySettings: {
          Title: "Google Safety Settings",
          SubTitle: "Select a safety filtering level",
        },
      },
      AI302: {
        ApiKey: {
          Title: "302.AI API Key",
          SubTitle: "Use a custom 302.AI API Key",
          Placeholder: "302.AI API Key",
        },
        Endpoint: {
          Title: "Endpoint Address",
          SubTitle: "Example: ",
        },
      },
    },

    Model: "Model",
    CompressModel: {
      Title: "Summary Model",
      SubTitle: "Model used to compress history and generate title",
    },
    Temperature: {
      Title: "Temperature",
      SubTitle: "A larger value makes the more random output",
    },
    TopP: {
      Title: "Top P",
      SubTitle: "Do not alter this value together with temperature",
    },
    MaxTokens: {
      Title: "Max Tokens",
      SubTitle: "Maximum length of input tokens and generated tokens",
    },
    PresencePenalty: {
      Title: "Presence Penalty",
      SubTitle:
        "A larger value increases the likelihood to talk about new topics",
    },
    FrequencyPenalty: {
      Title: "Frequency Penalty",
      SubTitle:
        "A larger value decreasing the likelihood to repeat the same line",
    },
    TTS: {
      Enable: {
        Title: "Enable TTS",
        SubTitle: "Enable text-to-speech service",
      },
      Autoplay: {
        Title: "Enable Autoplay",
        SubTitle:
          "Automatically generate speech and play, you need to enable the text-to-speech switch first",
      },
      Model: "Model",
      Voice: {
        Title: "Voice",
        SubTitle: "The voice to use when generating the audio",
      },
      Speed: {
        Title: "Speed",
        SubTitle: "The speed of the generated audio",
      },
      Engine: "TTS Engine",
    },
    Realtime: {
      Enable: {
        Title: "Realtime Chat",
        SubTitle: "Enable realtime chat feature",
      },
      Provider: {
        Title: "Model Provider",
        SubTitle: "Switch between different providers",
      },
      Model: {
        Title: "Model",
        SubTitle: "Select a model",
      },
      ApiKey: {
        Title: "API Key",
        SubTitle: "API Key",
        Placeholder: "API Key",
      },
      Azure: {
        Endpoint: {
          Title: "Endpoint",
          SubTitle: "Endpoint",
        },
        Deployment: {
          Title: "Deployment Name",
          SubTitle: "Deployment Name",
        },
      },
      Temperature: {
        Title: "Randomness (temperature)",
        SubTitle: "Higher values result in more random responses",
      },
    },
  },
  Store: {
    DefaultTopic: "New Conversation",
    BotHello: "Hello! How can I assist you today?",
    Error: "Something went wrong, please try again later.",
    Prompt: {
      History: (content: string) =>
        "This is a summary of the chat history as a recap: " + content,
      Topic:
        "Please generate a four to five word title summarizing our conversation without any lead-in, punctuation, quotation marks, periods, symbols, bold text, or additional text. Remove enclosing quotation marks.",
      Summarize:
        "Summarize the discussion briefly in 200 words or less to use as a prompt for future context.",
    },
  },
  Copy: {
    Success: "Copied to clipboard",
    Failed: "Copy failed, please grant permission to access clipboard",
  },
  Download: {
    Pending: "Downloading",
    Started: "Download started",
    Success: "Content downloaded to your directory.",
    Failed: "Download failed.",
  },
  Context: {
    Presets: "Preset Messages",
    Parameters: "Role & Parameters",
    Roles: {
      system: "System instruction",
      user: "User message",
      assistant: "Assistant reply",
    },
    Expand: "Expand",
    Collapse: "Collapse",
    OpenEditor: "Open Full Content",
    Preview: "Preview Prompt",
    Insert: "Insert into Input",
    Empty: "No preset messages",
    Delete: "Delete Preset",
    Move: "Drag to Reorder",
    Toast: (x: any) => `With ${x} contextual prompts`,
    Edit: "Current Chat Settings",
    Add: "Add a Prompt",
    Clear: "Context Cleared",
    Revert: "Revert",
  },
  Discovery: {
    Name: "Discovery",
  },
  Mcp: {
    Name: "MCP",
  },
  FineTuned: {
    Sysmessage: "You are an assistant that",
  },
  SearchChat: {
    Name: "Search Chat",
    Page: {
      Title: "Search Chat",
      Search: "Enter search keyword",
      NoResult: "No results found",
      NoData: "No data",
      Loading: "Loading",
      AllSessions: "All Sessions",
      SubTitle: (count: number) => `Found ${count} results`,
    },
    Item: {
      View: "View",
    },
  },
  Mask: {
    Name: "Mask",
    Page: {
      Title: "Prompt Template",
      SubTitle: (count: number) => `${count} prompt templates`,
      Search: "Search Templates",
      Create: "Create",
    },
    Item: {
      Info: (count: number) => `${count} prompts`,
      Chat: "Chat",
      View: "View",
      Edit: "Edit",
      Delete: "Delete",
      DeleteConfirm: "Confirm to delete?",
    },
    EditModal: {
      Title: (readonly: boolean) =>
        `Edit Prompt Template ${readonly ? "(readonly)" : ""}`,
      Download: "Download",
      Clone: "Clone",
    },
    Config: {
      Avatar: "Bot Avatar",
      Name: "Bot Name",
      Sync: {
        Title: "Use Global Config",
        SubTitle: "Use global config in this chat",
        Confirm: "Confirm to override custom config with global config?",
      },
      HideContext: {
        Title: "Hide Context Prompts",
        SubTitle: "Do not show in-context prompts in chat",
      },
      Artifacts: {
        Title: "Enable Artifacts",
        SubTitle: "Can render HTML page when enable artifacts.",
      },
      CodeFold: {
        Title: "Enable CodeFold",
        SubTitle:
          "Automatically collapse/expand overly long code blocks when CodeFold is enabled",
      },
      Share: {
        Title: "Share This Mask",
        SubTitle: "Generate a link to this mask",
        Action: "Copy Link",
      },
    },
  },
  NewChat: {
    Return: "Return",
    Skip: "Just Start",
    Title: "Pick a Mask",
    SubTitle: "Chat with the Soul behind the Mask",
    More: "Find More",
    NotShow: "Never Show Again",
    ConfirmNoShow: "Confirm to disable？You can enable it in settings later.",
  },

  UI: {
    Loading: "Loading",
    InstallApp: "Install App",
    DownloadApp: "Download App",
    InstallHint:
      "In Safari, tap Share and choose Add to Home Screen to install.",
    Confirm: "Confirm",
    Cancel: "Cancel",
    Close: "Close",
    Create: "Create",
    Edit: "Edit",
    Export: "Export",
    Import: "Import",
    Sync: "Sync",
    Config: "Config",
    Retry: "Retry",
  },
  Exporter: {
    Description: {
      Title: "Only messages after clearing the context will be displayed",
    },
    Model: "Model",
    Messages: "Messages",
    Topic: "Topic",
    Time: "Time",
  },
  URLCommand: {
    Code: "Detected access code from url, confirm to apply? ",
    Settings: "Detected settings from url, confirm to apply?",
  },

  Gallery: {
    Title: "Gallery",
    Settings: "Gallery settings",
    SelectImage: (prompt: string) => `Select image: ${prompt}`,
    Hint: "Notice: Images are saved locally in browser. Clearing cache will lose them.",
    Search: "Search prompts...",
    AllModels: "All Models",
    AllTime: "All Time",
    StorageInfo: (count: number) => `${count} works loaded`,
    StorageSize: (size: string) => `${size} used`,
    AutoSave: "Auto-save images to gallery",
    MaxCount: "Max images",
    MaxCountRange: "100 ~ 1000",
    BatchSelect: "Batch Select",
    ExportAll: "Export Gallery",
    DeleteFailed: "Delete Failed",
    DeleteSelected: "Delete Selected",
    CancelSelect: "Cancel",
    SelectAll: "Select All",
    Local: "Local",
    CopyPrompt: "Copy Prompt",
    SaveImage: "Save Image",
    Delete: "Delete",
    Empty: "No works yet",
    Exporting: "Exporting...",
    ExportComplete: (count: number) => `Exported ${count} works`,
    Deleted: "Deleted",
    Copied: "Copied",
    Saved: "Saved",
    ConfirmDelete:
      "Remove selected works? Video generation history will be kept.",
    ConfirmDeleteFailed: "Delete all failed images?",
    ImageLoadFailed: "Image load failed",
    TimeFilter: {
      All: "All Time",
      Today: "Today",
      Week: "This Week",
      Month: "This Month",
      Year: "This Year",
    },
  },
  Video: {
    Name: "Video Studio",
    Title: "Video Studio",
    Settings: "Settings",
    CollapseSettings: "Collapse Settings",
    ExpandSettings: "Expand Settings",
    CoreParams: "Core Parameters",
    AdvancedParams: "Advanced",
    OutputPrefs: "Output Preferences",
    Model: "Video Model",
    SelectModel: "Select Model",
    NoModels: "No models available",
    GenMode: "Generation Mode",
    TextToVideo: "Text to Video",
    ImageToVideo: "Image to Video",
    FirstLastFrame: "First-Last Frame",
    FirstFrame: "First Frame",
    LastFrame: "Last Frame",
    ReferenceImage: "Reference Image",
    UploadRefImage: "Drag or click to upload a reference image",
    Prompt: "Prompt",
    PromptPlaceholder:
      "Describe the video scene, style, camera movement, lighting...",
    NegativePrompt: "Negative Prompt",
    NegativePromptPlaceholder: "Describe what you don't want to see...",
    NegativePromptOptional: "Negative Prompt (optional)",
    AspectRatio: "Aspect Ratio",
    Ratio169: "16:9",
    Ratio916: "9:16",
    Ratio11: "1:1",
    Ratio43: "4:3",
    Ratio34: "3:4",
    Ratio219: "21:9",
    Resolution: "Resolution",
    Resolution480p: "480p",
    Resolution720p: "720p",
    Resolution1080p: "1080p",
    Resolution4k: "4k",
    Duration: "Duration",
    DurationMin: "4s",
    DurationMax: "15s",
    GenCount: "Generation Count",
    Seed: "Random Seed",
    SeedPlaceholder: "Empty = random",
    SeedRandom: "Random",
    PromptAdherence: "Prompt Adherence",
    PromptAdherenceHint: "Higher values match the prompt more strictly",
    CameraMotion: "Camera Motion Intensity",
    CameraMotionHint: "Lower values produce more stable footage",
    AutoPlay: "Auto-play after generation",
    AutoSaveGallery: "Auto-save to gallery",
    ConfirmBeforeGen: "Confirm before generating",
    DraftAutoSave: "Auto-save draft",
    Generate: "Generate Video",
    Generating: "Generating",
    GenStatusSubmitting: "Submitting request...",
    GenStatusInference: "Model inference...",
    GenStatusRendering: "Rendering frames...",
    GenStatusComposing: "Composing video...",
    GenStatusCover: "Generating cover...",
    GenStatusDone: "Generation complete",
    GenConfirm: "Confirm video generation?",
    AutoSavedToast: "Video saved to gallery",
    Results: "Results",
    ResultCount: "{count} items",
    Empty: 'Fill in the prompt on the left and click "Generate Video" to start',
    Download: "Download",
    Delete: "Delete",
    NoPrompt: "(no prompt)",
    Pending: "Generating...",
    Failed: "Generation failed",
    ImageTooLarge: "Image size cannot exceed 10MB",
    InvalidImage: "Please upload an image file",
  },
};

export default en;
