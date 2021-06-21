import { getStr } from "./wasm.ts";
import { Status } from "./constants.ts";
export default class SqliteError extends Error {
    constructor(context, code) {
        if (typeof context === "string") {
            super(context);
            this.code = code ?? Status.Unknown;
        }
        else {
            super(getStr(context, context.get_sqlite_error_str()));
            this.code = code ?? context.get_status();
        }
        this.name = "SqliteError";
    }
    code;
    get codeName() {
        return Status[this.code];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXJyb3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJlcnJvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFFQSxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sV0FBVyxDQUFDO0FBQ25DLE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQztBQUV4QyxNQUFNLENBQUMsT0FBTyxPQUFPLFdBQVksU0FBUSxLQUFLO0lBWTVDLFlBQVksT0FBc0IsRUFBRSxJQUFhO1FBQy9DLElBQUksT0FBTyxPQUFPLEtBQUssUUFBUSxFQUFFO1lBQy9CLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUNmLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUM7U0FDcEM7YUFBTTtZQUNMLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxvQkFBb0IsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUN2RCxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksSUFBSSxPQUFPLENBQUMsVUFBVSxFQUFFLENBQUM7U0FDMUM7UUFDRCxJQUFJLENBQUMsSUFBSSxHQUFHLGFBQWEsQ0FBQztJQUM1QixDQUFDO0lBMENELElBQUksQ0FBUztJQVdiLElBQUksUUFBUTtRQUNWLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQXdCLENBQUM7SUFDbEQsQ0FBQztDQUNGIn0=