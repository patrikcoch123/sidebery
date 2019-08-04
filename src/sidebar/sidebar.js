import Vue from 'vue'
import { mapGetters } from 'vuex'
import { initMsgHandling } from '../event-bus'
import Sidebar from './sidebar.vue'
import Dict from '../mixins/dict'
import { initActionsMixin } from '../mixins/act'
import Store from './store'
import State from './store/state'
import Actions from './actions'

if (!State.tabsMap) State.tabsMap = []
Vue.mixin(Dict)
Vue.mixin(initActionsMixin(Actions))

initMsgHandling(State, Actions)

export default new Vue({
  el: '#root',
  store: Store,

  components: {
    Sidebar,
  },

  data() {
    return {}
  },

  computed: {
    ...mapGetters(['pinnedTabs']),

    pinnedTabsPosition() {
      if (!this.pinnedTabs.length) return 'none'
      return State.pinnedTabsPosition
    },
  },

  beforeCreate() {
    browser.runtime.getPlatformInfo()
      .then(osInfo => {
        State.osInfo = osInfo
        State.os = osInfo.os
      })

    browser.runtime.getBrowserInfo()
      .then(ffInfo => {
        State.ffInfo = ffInfo
        State.ffVer = parseInt(ffInfo.version.slice(0, 2))
        if (isNaN(State.ffVer)) State.ffVer = 0
      })
  },

  async created() {
    browser.windows.onCreated.addListener(this.onWindowCreated)
    browser.windows.onRemoved.addListener(this.onWindowRemoved)
    browser.windows.onFocusChanged.addListener(this.onFocusWindow)
    browser.storage.onChanged.addListener(this.onChangeStorage)
    browser.commands.onCommand.addListener(this.onCmd)

    State.instanceType = 'sidebar'

    let currentWindow = await browser.windows.getCurrent()
    State.private = currentWindow.incognito
    State.windowId = currentWindow.id
    browser.windows.getAll()
      .then(windows => {
        State.otherWindows = windows.filter(w => w.id !== State.windowId)
      })

    await Actions.loadSettings()
    if (State.theme !== 'default') Actions.initTheme()
    if (State.sidebarCSS) Actions.loadCustomCSS()

    await Actions.loadPanelIndex()
    await Actions.loadPanels()

    if (State.bookmarksPanel && State.panels[State.panelIndex].type === 'bookmarks') {
      await Actions.loadBookmarks()
    }

    await Actions.loadTabs()
    await Actions.loadCtxMenu()
    await Actions.loadCSSVars()
    Actions.scrollToActiveTab()
    Actions.loadKeybindings()
    Actions.loadFavicons()
    Actions.loadPermissions()

    // Try to clear unneeded favicons
    Actions.tryClearFaviCache(86400)

    // Hide / show tabs
    Actions.updateTabsVisability()

    // Connect to background instance
    const connectInfo = JSON.stringify({
      instanceType: State.instanceType,
      windowId: State.windowId,
    })
    State.bg = browser.runtime.connect({ name: connectInfo })
  },

  mounted() {
    Actions.updateFontSize()
    Store.watch(Object.getOwnPropertyDescriptor(State, 'fontSize').get, function() {
      Actions.updateFontSize()
    })
  },

  beforeDestroy() {
    browser.windows.onFocusChanged.removeListener(this.onFocusWindow)
    browser.storage.onChanged.removeListener(this.onChangeStorage)
    browser.commands.onCommand.removeListener(this.onCmd)
  },

  methods: {
    /**
     * Handle new window
     */
    onWindowCreated(window) {
      if (window.id === State.windowId) return
      if (!State.otherWindows) State.otherWindows = []
      State.otherWindows.push(window)
    },

    /**
     * Handle window removng
     */
    onWindowRemoved(windowId) {
      if (windowId === State.windowId || !State.otherWindows) return
      let index = State.otherWindows.findIndex(w => w.id === windowId)
      if (index >= 0) State.otherWindows.splice(index, 1)
    },

    /**
     * Set currently focused window
     */
    onFocusWindow(id) {
      State.windowFocused = id === State.windowId
      if (State.windowFocused) {
        Actions.savePanelIndex()
      }
    },

    /**
     * Handle changes of all storages (update current state)
     */
    onChangeStorage(changes, type) {
      if (type !== 'local') return

      if (changes.settings) {
        Actions.updateSettings(changes.settings.newValue)
      }
      if (changes.cssVars) {
        Actions.applyCSSVars(changes.cssVars.newValue)
      }
      if (changes.panels && !State.windowFocused && !State.private) {
        Actions.updatePanels(changes.panels.newValue)
      }
      if (changes.tabsMenu) {
        State.tabsMenu = changes.tabsMenu.newValue
      }
      if (changes.bookmarksMenu) {
        State.bookmarksMenu = changes.bookmarksMenu.newValue
      }
      if (changes.sidebarCSS) {
        Actions.applyCustomCSS(changes.sidebarCSS.newValue)
      }
    },

    /**
     * Keybindings handler
     */
    onCmd(name) {
      if (!State.windowFocused) return
      let cmdName = 'kb_' + name
      if (Actions[cmdName]) Actions[cmdName]()
    },
  },
})
