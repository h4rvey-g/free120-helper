class FakeDomStringList {
  constructor(values = []) {
    this.values = values;
  }

  contains(value) {
    return this.values.includes(value);
  }
}

function requestSuccess(request, result, transaction = null) {
  queueMicrotask(() => {
    request.result = result;
    if (typeof request.onsuccess === 'function') {
      request.onsuccess({ target: request });
    }
    if (transaction) {
      transaction.completeSoon();
    }
  });
  return request;
}

function requestFailure(request, error, transaction = null) {
  queueMicrotask(() => {
    request.error = error;
    if (typeof request.onerror === 'function') {
      request.onerror({ target: request });
    }
    if (transaction) {
      transaction.abort(error);
    }
  });
  return request;
}

function keyForValue(key) {
  return Array.isArray(key) ? JSON.stringify(key) : String(key);
}

function getByKeyPath(record, keyPath) {
  if (Array.isArray(keyPath)) {
    return keyPath.map((entry) => record && record[entry]);
  }
  return record && record[keyPath];
}

class FakeIndexDefinition {
  constructor(name, keyPath, options = {}) {
    this.name = name;
    this.keyPath = keyPath;
    this.unique = Boolean(options.unique);
  }
}

class FakeObjectStoreData {
  constructor(name, options = {}) {
    this.name = name;
    this.keyPath = options.keyPath || 'id';
    this.records = new Map();
    this.indexes = new Map();
  }
}

class FakeObjectStoreHandle {
  constructor(data, transaction) {
    this.data = data;
    this.transaction = transaction;
    this.keyPath = data.keyPath;
  }

  get indexNames() {
    return new FakeDomStringList(Array.from(this.data.indexes.keys()));
  }

  createIndex(name, keyPath, options = {}) {
    const definition = new FakeIndexDefinition(name, keyPath, options);
    this.data.indexes.set(name, definition);
    return new FakeIndexHandle(this.data, definition, this.transaction);
  }

  index(name) {
    const definition = this.data.indexes.get(name);
    if (!definition) {
      throw new Error(`Missing fake index: ${name}`);
    }
    return new FakeIndexHandle(this.data, definition, this.transaction);
  }

  put(record) {
    const request = {};
    try {
      const key = getByKeyPath(record, this.data.keyPath);
      this.data.records.set(keyForValue(key), structuredClone(record));
      return requestSuccess(request, key, this.transaction);
    } catch (error) {
      return requestFailure(request, error, this.transaction);
    }
  }

  get(key) {
    const request = {};
    const record = this.data.records.get(keyForValue(key));
    return requestSuccess(request, record ? structuredClone(record) : undefined, this.transaction);
  }

  getAll() {
    const request = {};
    const records = Array.from(this.data.records.values()).map((record) => structuredClone(record));
    return requestSuccess(request, records, this.transaction);
  }

  delete(key) {
    const request = {};
    this.data.records.delete(keyForValue(key));
    return requestSuccess(request, undefined, this.transaction);
  }

  clear() {
    const request = {};
    this.data.records.clear();
    return requestSuccess(request, undefined, this.transaction);
  }
}

class FakeIndexHandle {
  constructor(storeData, definition, transaction) {
    this.storeData = storeData;
    this.definition = definition;
    this.transaction = transaction;
  }

  matchingRecords(key) {
    const expected = keyForValue(key);
    return Array.from(this.storeData.records.values())
      .filter((record) => keyForValue(getByKeyPath(record, this.definition.keyPath)) === expected)
      .map((record) => structuredClone(record));
  }

  getAll(key) {
    return requestSuccess({}, this.matchingRecords(key), this.transaction);
  }

  get(key) {
    return requestSuccess({}, this.matchingRecords(key)[0], this.transaction);
  }

  openCursor(key) {
    const request = {};
    const records = this.matchingRecords(key);
    let index = 0;
    const next = () => {
      queueMicrotask(() => {
        if (index >= records.length) {
          request.result = null;
          if (typeof request.onsuccess === 'function') {
            request.onsuccess({ target: request });
          }
          this.transaction.completeSoon();
          return;
        }
        const record = records[index];
        index += 1;
        request.result = new FakeCursor(this.storeData, record, next);
        if (typeof request.onsuccess === 'function') {
          request.onsuccess({ target: request });
        }
      });
    };
    next();
    return request;
  }
}

class FakeCursor {
  constructor(storeData, record, next) {
    this.storeData = storeData;
    this.record = record;
    this.next = next;
  }

  delete() {
    const key = getByKeyPath(this.record, this.storeData.keyPath);
    this.storeData.records.delete(keyForValue(key));
    return requestSuccess({}, undefined, null);
  }

  continue() {
    this.next();
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.error = null;
    this.completed = false;
  }

  get objectStoreNames() {
    return this.db.objectStoreNames;
  }

  objectStore(name) {
    const data = this.db.stores.get(name);
    if (!data) {
      throw new Error(`Missing fake object store: ${name}`);
    }
    return new FakeObjectStoreHandle(data, this);
  }

  completeSoon() {
    if (this.completed) {
      return;
    }
    this.completed = true;
    queueMicrotask(() => {
      if (typeof this.oncomplete === 'function') {
        this.oncomplete({ target: this });
      }
    });
  }

  abort(error) {
    this.error = error;
    if (typeof this.onabort === 'function') {
      this.onabort({ target: this });
    }
  }
}

class FakeDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this.stores = new Map();
  }

  get objectStoreNames() {
    return new FakeDomStringList(Array.from(this.stores.keys()));
  }

  createObjectStore(name, options = {}) {
    const data = new FakeObjectStoreData(name, options);
    this.stores.set(name, data);
    return new FakeObjectStoreHandle(data, new FakeTransaction(this));
  }

  transaction(storeName) {
    if (Array.isArray(storeName)) {
      storeName.forEach((name) => {
        if (!this.stores.has(name)) {
          throw new Error(`Missing fake object store: ${name}`);
        }
      });
    } else if (!this.stores.has(storeName)) {
      throw new Error(`Missing fake object store: ${storeName}`);
    }
    return new FakeTransaction(this);
  }

  close() {}
}

function createFakeIndexedDB() {
  const databases = new Map();
  return {
    open(name, version = 1) {
      const request = {};
      queueMicrotask(() => {
        const oldDatabase = databases.get(name) || null;
        const oldVersion = oldDatabase ? oldDatabase.version : 0;
        const db = oldDatabase || new FakeDatabase(name, version);
        db.version = Math.max(db.version || 0, version);
        databases.set(name, db);
        request.result = db;
        request.transaction = new FakeTransaction(db);
        if (oldVersion < version && typeof request.onupgradeneeded === 'function') {
          request.onupgradeneeded({ target: request, oldVersion, newVersion: version });
        }
        queueMicrotask(() => {
          if (typeof request.onsuccess === 'function') {
            request.onsuccess({ target: request });
          }
        });
      });
      return request;
    },
  };
}

export { createFakeIndexedDB };
