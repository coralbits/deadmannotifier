const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

class Database {
  constructor(dbPath = "deadman.db") {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          this.runMigrations()
            .then(() => resolve())
            .catch(reject);
        }
      });
    });
  }

  async runMigrations() {
    const schemaPath = path.join(__dirname, "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");

    return new Promise((resolve, reject) => {
      this.db.exec(schema, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async insertEvent(serviceId, state, logs = null, sourceIp = null) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO events (service_id, state, logs, source_ip)
        VALUES (?, ?, ?, ?)
      `;

      this.db.run(sql, [serviceId, state, logs, sourceIp], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  async updateCurrentState(serviceId, state) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO current_state (service_id, state, last_updated)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `;

      this.db.run(sql, [serviceId, state], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  async getCurrentStates() {
    return new Promise((resolve, reject) => {
      const sql = "SELECT * FROM current_state ORDER BY service_id";

      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getLatestEvents(limit = 10) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM events 
        ORDER BY timestamp DESC 
        LIMIT ?
      `;

      this.db.all(sql, [limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getLatestEventForService(serviceId) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM events 
        WHERE service_id = ?
        ORDER BY timestamp DESC 
        LIMIT 1
      `;

      this.db.get(sql, [serviceId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async markAllServicesAsNak() {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE current_state 
        SET state = 'nak', last_updated = CURRENT_TIMESTAMP
      `;

      this.db.run(sql, [], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = Database;
