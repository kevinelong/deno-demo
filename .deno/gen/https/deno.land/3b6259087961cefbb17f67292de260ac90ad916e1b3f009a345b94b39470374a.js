import { assert, compile, pathParse, pathToRegexp, Status, } from "./deps.ts";
import { httpErrors } from "./httpError.ts";
import { compose } from "./middleware.ts";
import { decodeComponent } from "./util.ts";
function toUrl(url, params = {}, options) {
    const tokens = pathParse(url);
    let replace = {};
    if (tokens.some((token) => typeof token === "object")) {
        replace = params;
    }
    else {
        options = params;
    }
    const toPath = compile(url, options);
    const replaced = toPath(replace);
    if (options && options.query) {
        const url = new URL(replaced, "http://oak");
        if (typeof options.query === "string") {
            url.search = options.query;
        }
        else {
            url.search = String(options.query instanceof URLSearchParams
                ? options.query
                : new URLSearchParams(options.query));
        }
        return `${url.pathname}${url.search}${url.hash}`;
    }
    return replaced;
}
class Layer {
    #opts;
    #paramNames = [];
    #regexp;
    methods;
    name;
    path;
    stack;
    constructor(path, methods, middleware, { name, ...opts } = {}) {
        this.#opts = opts;
        this.name = name;
        this.methods = [...methods];
        if (this.methods.includes("GET")) {
            this.methods.unshift("HEAD");
        }
        this.stack = Array.isArray(middleware) ? middleware.slice() : [middleware];
        this.path = path;
        this.#regexp = pathToRegexp(path, this.#paramNames, this.#opts);
    }
    clone() {
        return new Layer(this.path, this.methods, this.stack, { name: this.name, ...this.#opts });
    }
    match(path) {
        return this.#regexp.test(path);
    }
    params(captures, existingParams = {}) {
        const params = existingParams;
        for (let i = 0; i < captures.length; i++) {
            if (this.#paramNames[i]) {
                const c = captures[i];
                params[this.#paramNames[i].name] = c ? decodeComponent(c) : c;
            }
        }
        return params;
    }
    captures(path) {
        if (this.#opts.ignoreCaptures) {
            return [];
        }
        return path.match(this.#regexp)?.slice(1) ?? [];
    }
    url(params = {}, options) {
        const url = this.path.replace(/\(\.\*\)/g, "");
        return toUrl(url, params, options);
    }
    param(param, fn) {
        const stack = this.stack;
        const params = this.#paramNames;
        const middleware = function (ctx, next) {
            const p = ctx.params[param];
            assert(p);
            return fn.call(this, p, ctx, next);
        };
        middleware.param = param;
        const names = params.map((p) => p.name);
        const x = names.indexOf(param);
        if (x >= 0) {
            for (let i = 0; i < stack.length; i++) {
                const fn = stack[i];
                if (!fn.param || names.indexOf(fn.param) > x) {
                    stack.splice(i, 0, middleware);
                    break;
                }
            }
        }
        return this;
    }
    setPrefix(prefix) {
        if (this.path) {
            this.path = this.path !== "/" || this.#opts.strict === true
                ? `${prefix}${this.path}`
                : prefix;
            this.#paramNames = [];
            this.#regexp = pathToRegexp(this.path, this.#paramNames, this.#opts);
        }
        return this;
    }
    toJSON() {
        return {
            methods: [...this.methods],
            middleware: [...this.stack],
            paramNames: this.#paramNames.map((key) => key.name),
            path: this.path,
            regexp: this.#regexp,
            options: { ...this.#opts },
        };
    }
}
export class Router {
    #opts;
    #methods;
    #params = {};
    #stack = [];
    #match = (path, method) => {
        const matches = {
            path: [],
            pathAndMethod: [],
            route: false,
        };
        for (const route of this.#stack) {
            if (route.match(path)) {
                matches.path.push(route);
                if (route.methods.length === 0 || route.methods.includes(method)) {
                    matches.pathAndMethod.push(route);
                    if (route.methods.length) {
                        matches.route = true;
                    }
                }
            }
        }
        return matches;
    };
    #register = (path, middlewares, methods, options = {}) => {
        if (Array.isArray(path)) {
            for (const p of path) {
                this.#register(p, middlewares, methods, options);
            }
            return;
        }
        let layerMiddlewares = [];
        for (const middleware of middlewares) {
            if (!middleware.router) {
                layerMiddlewares.push(middleware);
                continue;
            }
            if (layerMiddlewares.length) {
                this.#addLayer(path, layerMiddlewares, methods, options);
                layerMiddlewares = [];
            }
            const router = middleware.router.#clone();
            for (const layer of router.#stack) {
                if (!options.ignorePrefix) {
                    layer.setPrefix(path);
                }
                if (this.#opts.prefix) {
                    layer.setPrefix(this.#opts.prefix);
                }
                this.#stack.push(layer);
            }
            for (const [param, mw] of Object.entries(this.#params)) {
                router.param(param, mw);
            }
        }
        if (layerMiddlewares.length) {
            this.#addLayer(path, layerMiddlewares, methods, options);
        }
    };
    #addLayer = (path, middlewares, methods, options = {}) => {
        const { end, name, sensitive = this.#opts.sensitive, strict = this.#opts.strict, ignoreCaptures, } = options;
        const route = new Layer(path, methods, middlewares, {
            end,
            name,
            sensitive,
            strict,
            ignoreCaptures,
        });
        if (this.#opts.prefix) {
            route.setPrefix(this.#opts.prefix);
        }
        for (const [param, mw] of Object.entries(this.#params)) {
            route.param(param, mw);
        }
        this.#stack.push(route);
    };
    #route = (name) => {
        for (const route of this.#stack) {
            if (route.name === name) {
                return route;
            }
        }
    };
    #useVerb = (nameOrPath, pathOrMiddleware, middleware, methods) => {
        let name = undefined;
        let path;
        if (typeof pathOrMiddleware === "string") {
            name = nameOrPath;
            path = pathOrMiddleware;
        }
        else {
            path = nameOrPath;
            middleware.unshift(pathOrMiddleware);
        }
        this.#register(path, middleware, methods, { name });
    };
    #clone = () => {
        const router = new Router(this.#opts);
        router.#methods = router.#methods.slice();
        router.#params = { ...this.#params };
        router.#stack = this.#stack.map((layer) => layer.clone());
        return router;
    };
    constructor(opts = {}) {
        this.#opts = opts;
        this.#methods = opts.methods ?? [
            "DELETE",
            "GET",
            "HEAD",
            "OPTIONS",
            "PATCH",
            "POST",
            "PUT",
        ];
    }
    all(nameOrPath, pathOrMiddleware, ...middleware) {
        this.#useVerb(nameOrPath, pathOrMiddleware, middleware, ["DELETE", "GET", "POST", "PUT"]);
        return this;
    }
    allowedMethods(options = {}) {
        const implemented = this.#methods;
        const allowedMethods = async (context, next) => {
            const ctx = context;
            await next();
            if (!ctx.response.status || ctx.response.status === Status.NotFound) {
                assert(ctx.matched);
                const allowed = new Set();
                for (const route of ctx.matched) {
                    for (const method of route.methods) {
                        allowed.add(method);
                    }
                }
                const allowedStr = [...allowed].join(", ");
                if (!implemented.includes(ctx.request.method)) {
                    if (options.throw) {
                        throw options.notImplemented
                            ? options.notImplemented()
                            : new httpErrors.NotImplemented();
                    }
                    else {
                        ctx.response.status = Status.NotImplemented;
                        ctx.response.headers.set("Allowed", allowedStr);
                    }
                }
                else if (allowed.size) {
                    if (ctx.request.method === "OPTIONS") {
                        ctx.response.status = Status.OK;
                        ctx.response.headers.set("Allowed", allowedStr);
                    }
                    else if (!allowed.has(ctx.request.method)) {
                        if (options.throw) {
                            throw options.methodNotAllowed
                                ? options.methodNotAllowed()
                                : new httpErrors.MethodNotAllowed();
                        }
                        else {
                            ctx.response.status = Status.MethodNotAllowed;
                            ctx.response.headers.set("Allowed", allowedStr);
                        }
                    }
                }
            }
        };
        return allowedMethods;
    }
    delete(nameOrPath, pathOrMiddleware, ...middleware) {
        this.#useVerb(nameOrPath, pathOrMiddleware, middleware, ["DELETE"]);
        return this;
    }
    *entries() {
        for (const route of this.#stack) {
            const value = route.toJSON();
            yield [value, value];
        }
    }
    forEach(callback, thisArg = null) {
        for (const route of this.#stack) {
            const value = route.toJSON();
            callback.call(thisArg, value, value, this);
        }
    }
    get(nameOrPath, pathOrMiddleware, ...middleware) {
        this.#useVerb(nameOrPath, pathOrMiddleware, middleware, ["GET"]);
        return this;
    }
    head(nameOrPath, pathOrMiddleware, ...middleware) {
        this.#useVerb(nameOrPath, pathOrMiddleware, middleware, ["HEAD"]);
        return this;
    }
    *keys() {
        for (const route of this.#stack) {
            yield route.toJSON();
        }
    }
    options(nameOrPath, pathOrMiddleware, ...middleware) {
        this.#useVerb(nameOrPath, pathOrMiddleware, middleware, ["OPTIONS"]);
        return this;
    }
    param(param, middleware) {
        this.#params[param] = middleware;
        for (const route of this.#stack) {
            route.param(param, middleware);
        }
        return this;
    }
    patch(nameOrPath, pathOrMiddleware, ...middleware) {
        this.#useVerb(nameOrPath, pathOrMiddleware, middleware, ["PATCH"]);
        return this;
    }
    post(nameOrPath, pathOrMiddleware, ...middleware) {
        this.#useVerb(nameOrPath, pathOrMiddleware, middleware, ["POST"]);
        return this;
    }
    prefix(prefix) {
        prefix = prefix.replace(/\/$/, "");
        this.#opts.prefix = prefix;
        for (const route of this.#stack) {
            route.setPrefix(prefix);
        }
        return this;
    }
    put(nameOrPath, pathOrMiddleware, ...middleware) {
        this.#useVerb(nameOrPath, pathOrMiddleware, middleware, ["PUT"]);
        return this;
    }
    redirect(source, destination, status = Status.Found) {
        if (source[0] !== "/") {
            const s = this.url(source);
            if (!s) {
                throw new RangeError(`Could not resolve named route: "${source}"`);
            }
            source = s;
        }
        if (typeof destination === "string") {
            if (destination[0] !== "/") {
                const d = this.url(destination);
                if (!d) {
                    try {
                        const url = new URL(destination);
                        destination = url;
                    }
                    catch {
                        throw new RangeError(`Could not resolve named route: "${source}"`);
                    }
                }
                else {
                    destination = d;
                }
            }
        }
        this.all(source, async (ctx, next) => {
            await next();
            ctx.response.redirect(destination);
            ctx.response.status = status;
        });
        return this;
    }
    routes() {
        const dispatch = (context, next) => {
            const ctx = context;
            let pathname;
            let method;
            try {
                const { url: { pathname: p }, method: m } = ctx.request;
                pathname = p;
                method = m;
            }
            catch (e) {
                return Promise.reject(e);
            }
            const path = this.#opts.routerPath ?? ctx.routerPath ??
                decodeURIComponent(pathname);
            const matches = this.#match(path, method);
            if (ctx.matched) {
                ctx.matched.push(...matches.path);
            }
            else {
                ctx.matched = [...matches.path];
            }
            ctx.router = this;
            if (!matches.route)
                return next();
            const { pathAndMethod: matchedRoutes } = matches;
            const chain = matchedRoutes.reduce((prev, route) => [
                ...prev,
                (ctx, next) => {
                    ctx.captures = route.captures(path);
                    ctx.params = route.params(ctx.captures, ctx.params);
                    ctx.routeName = route.name;
                    return next();
                },
                ...route.stack,
            ], []);
            return compose(chain)(ctx, next);
        };
        dispatch.router = this;
        return dispatch;
    }
    url(name, params, options) {
        const route = this.#route(name);
        if (route) {
            return route.url(params, options);
        }
    }
    use(pathOrMiddleware, ...middleware) {
        let path;
        if (typeof pathOrMiddleware === "string" || Array.isArray(pathOrMiddleware)) {
            path = pathOrMiddleware;
        }
        else {
            middleware.unshift(pathOrMiddleware);
        }
        this.#register(path ?? "(.*)", middleware, [], { end: false, ignoreCaptures: !path, ignorePrefix: !path });
        return this;
    }
    *values() {
        for (const route of this.#stack) {
            yield route.toJSON();
        }
    }
    *[Symbol.iterator]() {
        for (const route of this.#stack) {
            yield route.toJSON();
        }
    }
    static url(path, params, options) {
        return toUrl(path, params, options);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicm91dGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicm91dGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQTZCQSxPQUFPLEVBQ0wsTUFBTSxFQUNOLE9BQU8sRUFHUCxTQUFTLEVBQ1QsWUFBWSxFQUNaLE1BQU0sR0FFUCxNQUFNLFdBQVcsQ0FBQztBQUNuQixPQUFPLEVBQUUsVUFBVSxFQUFFLE1BQU0sZ0JBQWdCLENBQUM7QUFDNUMsT0FBTyxFQUFFLE9BQU8sRUFBYyxNQUFNLGlCQUFpQixDQUFDO0FBRXRELE9BQU8sRUFBRSxlQUFlLEVBQUUsTUFBTSxXQUFXLENBQUM7QUF1SjVDLFNBQVMsS0FBSyxDQUFDLEdBQVcsRUFBRSxTQUFzQixFQUFFLEVBQUUsT0FBb0I7SUFDeEUsTUFBTSxNQUFNLEdBQUcsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQzlCLElBQUksT0FBTyxHQUFnQixFQUFFLENBQUM7SUFFOUIsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxPQUFPLEtBQUssS0FBSyxRQUFRLENBQUMsRUFBRTtRQUNyRCxPQUFPLEdBQUcsTUFBTSxDQUFDO0tBQ2xCO1NBQU07UUFDTCxPQUFPLEdBQUcsTUFBTSxDQUFDO0tBQ2xCO0lBRUQsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsRUFBRSxPQUFPLENBQUMsQ0FBQztJQUNyQyxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7SUFFakMsSUFBSSxPQUFPLElBQUksT0FBTyxDQUFDLEtBQUssRUFBRTtRQUM1QixNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxRQUFRLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFDNUMsSUFBSSxPQUFPLE9BQU8sQ0FBQyxLQUFLLEtBQUssUUFBUSxFQUFFO1lBQ3JDLEdBQUcsQ0FBQyxNQUFNLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQztTQUM1QjthQUFNO1lBQ0ws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