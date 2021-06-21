import { getStr } from "./wasm.ts";
import { Status, Types, Values } from "./constants.ts";
import SqliteError from "./error.ts";
import { RowObjects } from "./row_objects.ts";
export class Rows {
    _wasm;
    _stmt;
    _cleanup;
    _done;
    constructor(wasm, stmt, cleanup) {
        this._wasm = wasm;
        this._stmt = stmt;
        this._done = false;
        this._cleanup = cleanup;
        if (wasm == null) {
            this._done = true;
        }
    }
    return() {
        if (!this._done) {
            if (this._cleanup != null) {
                this._wasm.finalize(this._stmt);
                this._cleanup.delete(this._stmt);
            }
            this._done = true;
        }
        return { done: true, value: null };
    }
    done() {
        this.return();
    }
    next() {
        if (this._done)
            return { value: null, done: true };
        const row = this._get();
        const status = this._wasm.step(this._stmt);
        switch (status) {
            case Status.SqliteRow:
                break;
            case Status.SqliteDone:
                this.return();
                break;
            default:
                this.return();
                throw new SqliteError(this._wasm, status);
                break;
        }
        return { value: row, done: false };
    }
    columns() {
        if (this._done) {
            throw new SqliteError("Unable to retrieve column names as transaction is finalized.");
        }
        const columnCount = this._wasm.column_count(this._stmt);
        const columns = [];
        for (let i = 0; i < columnCount; i++) {
            const name = getStr(this._wasm, this._wasm.column_name(this._stmt, i));
            const originName = getStr(this._wasm, this._wasm.column_origin_name(this._stmt, i));
            const tableName = getStr(this._wasm, this._wasm.column_table_name(this._stmt, i));
            columns.push({ name, originName, tableName });
        }
        return columns;
    }
    asObjects() {
        return new RowObjects(this);
    }
    [Symbol.iterator]() {
        return this;
    }
    _get() {
        const row = [];
        for (let i = 0, c = this._wasm.column_count(this._stmt); i < c; i++) {
            switch (this._wasm.column_type(this._stmt, i)) {
                case Types.Integer:
                    row.push(this._wasm.column_int(this._stmt, i));
                    break;
                case Types.Float:
                    row.push(this._wasm.column_double(this._stmt, i));
                    break;
                case Types.Text:
                    row.push(getStr(this._wasm, this._wasm.column_text(this._stmt, i)));
                    break;
                case Types.Blob: {
                    const ptr = this._wasm.column_blob(this._stmt, i);
                    if (ptr === 0) {
                        row.push(null);
                    }
                    else {
                        const length = this._wasm.column_bytes(this._stmt, i);
                        row.push(new Uint8Array(this._wasm.memory.buffer, ptr, length).slice());
                    }
                    break;
                }
                case Types.BigInteger: {
                    const ptr = this._wasm.column_text(this._stmt, i);
                    row.push(BigInt(getStr(this._wasm, ptr)));
                    break;
                }
                default:
                    row.push(null);
                    break;
            }
        }
        return row;
    }
}
export const Empty = new Rows(null, Values.Null);
Empty._done = true;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm93cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInJvd3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBRUEsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLFdBQVcsQ0FBQztBQUNuQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQztBQUN2RCxPQUFPLFdBQVcsTUFBTSxZQUFZLENBQUM7QUFDckMsT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLGtCQUFrQixDQUFDO0FBUTlDLE1BQU0sT0FBTyxJQUFJO0lBQ1AsS0FBSyxDQUFPO0lBQ1osS0FBSyxDQUFlO0lBQ3BCLFFBQVEsQ0FBcUI7SUFDN0IsS0FBSyxDQUFVO0lBYXZCLFlBQVksSUFBVSxFQUFFLElBQWtCLEVBQUUsT0FBMkI7UUFDckUsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUM7UUFDbEIsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUM7UUFDbEIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7UUFHbkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUM7UUFFeEIsSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO1lBQ2hCLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDO1NBQ25CO0lBQ0gsQ0FBQztJQVNELE1BQU07UUFDSixJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRTtZQUdmLElBQUksSUFBSSxDQUFDLFFBQVEsSUFBSSxJQUFJLEVBQUU7Z0JBQ3pCLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDaEMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO2FBQ2xDO1lBQ0QsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUM7U0FDbkI7UUFDRCxPQUFPLEVBQUUsSUFBSSxFQUFFLElB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