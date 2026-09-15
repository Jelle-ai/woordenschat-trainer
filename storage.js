// Opslag van woordenlijsten, voortgang en instellingen in localStorage.
const Storage = (() => {
  const K_LISTS = "wst_lists_v2";
  const K_ACTIVE = "wst_active_v2";
  const K_STATS = "wst_stats_v2";
  const K_SETTINGS = "wst_settings_v2";

  const DEFAULT_ID = "default";

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      // Privémodus of vol geheugen: de app blijft werken, alleen zonder bewaren.
      return false;
    }
  }

  function customLists() {
    const lists = read(K_LISTS, []);
    return Array.isArray(lists) ? lists : [];
  }

  function allLists() {
    return [{ id: DEFAULT_ID, name: "Standaardlijst (60 woorden)", words: DEFAULT_WORDS }].concat(customLists());
  }

  function getList(id) {
    return allLists().find((l) => l.id === id) || allLists()[0];
  }

  function activeId() {
    const id = read(K_ACTIVE, DEFAULT_ID);
    return allLists().some((l) => l.id === id) ? id : DEFAULT_ID;
  }

  function setActiveId(id) {
    write(K_ACTIVE, id);
  }

  function newId() {
    return "list_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function saveList({ id, name, words }) {
    const lists = customLists();
    const listId = id && id !== DEFAULT_ID ? id : newId();
    const existing = lists.findIndex((l) => l.id === listId);
    const entry = { id: listId, name: name || "Naamloze lijst", words, createdAt: Date.now() };
    if (existing >= 0) {
      entry.createdAt = lists[existing].createdAt || entry.createdAt;
      lists[existing] = entry;
    } else {
      lists.push(entry);
    }
    write(K_LISTS, lists);
    setActiveId(listId);
    return listId;
  }

  function deleteList(id) {
    if (id === DEFAULT_ID) return false;
    write(K_LISTS, customLists().filter((l) => l.id !== id));
    setActiveId(DEFAULT_ID);
    return true;
  }

  // Voortgang per Frans woord, gedeeld over alle lijsten.
  function getStats() {
    const s = read(K_STATS, {});
    return s && typeof s === "object" ? s : {};
  }

  function saveStats(stats) {
    write(K_STATS, stats);
  }

  function getSettings() {
    const s = read(K_SETTINGS, {});
    return {
      batchSize: s.batchSize || 7,
      strictAccents: !!s.strictAccents,
      direction: s.direction || "nl-fr", // nl-fr, fr-nl of gemengd
      showAccents: s.showAccents !== false,
    };
  }

  function saveSettings(settings) {
    write(K_SETTINGS, settings);
  }

  return {
    DEFAULT_ID,
    allLists,
    getList,
    activeId,
    setActiveId,
    saveList,
    deleteList,
    getStats,
    saveStats,
    getSettings,
    saveSettings,
  };
})();
