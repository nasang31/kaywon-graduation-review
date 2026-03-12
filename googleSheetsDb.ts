import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export class GoogleSheetsDB {
  private doc: GoogleSpreadsheet;
  private sheets: Record<string, any> = {};
  private data: Record<string, any[]> = {};
  private initialized = false;

  constructor(sheetId: string, email: string, privateKey: string) {
    const auth = new JWT({
      email: email,
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.doc = new GoogleSpreadsheet(sheetId, auth);
  }

  async init() {
    if (this.initialized) return;
    await this.doc.loadInfo();
    
    const sheetNames = ['users', 'rounds', 'proposals', 'works', 'work_images', 'evaluations'];
    for (const name of sheetNames) {
      let sheet = this.doc.sheetsByTitle[name];
      if (!sheet) {
        sheet = await this.doc.addSheet({ title: name });
        // Set headers
        const headers = this.getHeaders(name);
        await sheet.setHeaderRow(headers);
      }
      this.sheets[name] = sheet;
      const rows = await sheet.getRows();
      this.data[name] = rows.map(row => row.toObject());
    }
    this.initialized = true;
    console.log('Google Sheets DB initialized');
  }

  private getHeaders(name: string): string[] {
    switch (name) {
      case 'users': return ['id', 'username', 'password', 'role', 'name', 'student_id', 'needs_password_change', 'initial_password'];
      case 'rounds': return ['round_number', 'is_open', 'name'];
      case 'proposals': return ['id', 'user_id', 'round_number', 'student_id', 'name', 'career_path', 'title', 'author', 'genre', 'plot', 'subject', 'reason', 'is_submitted', 'presentation_order', 'is_participating', 'created_at'];
      case 'works': return ['id', 'proposal_id', 'work_number', 'title', 'category', 'summary', 'keywords', 'purpose', 'effect'];
      case 'work_images': return ['id', 'work_id', 'url'];
      case 'evaluations': return ['id', 'proposal_id', 'judge_id', 'text_grade', 'work1_grade', 'work2_grade', 'work3_grade', 'comment', 'created_at'];
      default: return [];
    }
  }

  async query(table: string, filter?: (row: any) => boolean) {
    await this.init();
    let rows = this.data[table] || [];
    if (filter) {
      rows = rows.filter(filter);
    }
    return rows;
  }

  async get(table: string, filter: (row: any) => boolean) {
    const rows = await this.query(table, filter);
    return rows[0] || null;
  }

  async insert(table: string, rowData: any) {
    await this.init();
    const sheet = this.sheets[table];
    
    // Auto-increment ID if not provided
    if (!rowData.id && this.getHeaders(table).includes('id')) {
      const maxId = this.data[table].reduce((max, r) => Math.max(max, Number(r.id) || 0), 0);
      rowData.id = maxId + 1;
    }
    
    const row = await sheet.addRow(rowData);
    this.data[table].push(row.toObject());
    return rowData;
  }

  async update(table: string, filter: (row: any) => boolean, updateData: any) {
    await this.init();
    const sheet = this.sheets[table];
    const rows = await sheet.getRows();
    
    let updatedCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const rowObj = rows[i].toObject();
      if (filter(rowObj)) {
        Object.assign(rows[i], updateData);
        await rows[i].save();
        this.data[table][i] = rows[i].toObject();
        updatedCount++;
      }
    }
    return { changes: updatedCount };
  }

  async delete(table: string, filter: (row: any) => boolean) {
    await this.init();
    const sheet = this.sheets[table];
    const rows = await sheet.getRows();
    
    let deletedCount = 0;
    // Iterate backwards to avoid index issues when deleting
    for (let i = rows.length - 1; i >= 0; i--) {
      const rowObj = rows[i].toObject();
      if (filter(rowObj)) {
        await rows[i].delete();
        this.data[table].splice(i, 1);
        deletedCount++;
      }
    }
    return { changes: deletedCount };
  }

  async clear(table: string, filter?: (row: any) => boolean) {
    if (!filter) {
      await this.init();
      const sheet = this.sheets[table];
      await sheet.clearRows();
      this.data[table] = [];
      return { changes: 1 };
    } else {
      return this.delete(table, filter);
    }
  }
}
