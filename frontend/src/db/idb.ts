const DB_NAME = 'tulipsedu'
const DB_VERSION = 1

let _db: IDBDatabase | null = null

export async function openDB(): Promise<IDBDatabase> {
  if (_db) return _db
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('attendance_queue')) {
        db.createObjectStore('attendance_queue', { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result
      resolve(_db)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function enqueue(storeName: string, record: unknown): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).add(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function dequeueAll(storeName: string): Promise<unknown[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const results: unknown[] = []
    const cursor = store.openCursor()
    cursor.onsuccess = (e) => {
      const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result
      if (c) {
        results.push(c.value)
        c.delete()
        c.continue()
      } else {
        resolve(results)
      }
    }
    cursor.onerror = () => reject(cursor.error)
  })
}
