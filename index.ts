import {Application, Context, join, Router, send} from './mod.ts';
import {DB} from "https://deno.land/x/sqlite/mod.ts";

class Model {
    db;

    constructor(db: any) {
        this.db = db;
    }

    createTable() {
        this.db.query(`CREATE TABLE IF NOT EXISTS people
                       (
                           id       INTEGER PRIMARY KEY AUTOINCREMENT,
                           name     TEXT,
                           password TEXT default ''
                       );`);
    }

    addData() {
        [{name: "huey", password: "hhh"},
            {name: "dewey", password: "ddd"},
            {name: "louie", password: "lll"}].map(
                (person) => this.db.query(
                    "INSERT INTO people (name, password) VALUES (?, ?)",
                    [person.name, person.password]
                )
        );
    }

    outputData() {
        const data = this.db.query("SELECT name, password FROM people");
        for (const [name, password] of data) {
            console.log(name, password);
        }
    }
}

const db = new DB("demo.db");
const m = new Model(db);
m.createTable();
m.addData();
m.outputData();
db.close();

const app = new Application();
const router = new Router();
const getTestResponse = ({response}: { response: any }) => {
    response.status = 200

    response.headers.set("Content-Type", "application/json") // set to html if you want
    response.body = {
        data: "test"
    }
}
router.get('/static/:path+', async (ctx: Context) => {
    return await send(ctx, ctx.request.url.pathname, {root: Deno.cwd()});
});

router.get('/', (context) => {
    context.response.redirect("/static/index.html");
});

router.get("/data/", (context) => {
    context.response.status = 200
    context.response.headers.set("Content-Type", "application/json") // set to html if you want

    context.response.body = {
        data: "test"
    };
});

app.use(router.routes())
app.use(router.allowedMethods());

await app.listen({port: 8000});


