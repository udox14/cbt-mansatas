var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err2) {
          if (err2 instanceof Error && onError) {
            context.error = err2;
            res = await onError(err2, context);
            isError = true;
          } else {
            throw err2;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/body.js
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");

// node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder2) => {
  try {
    return decoder2(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder2(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURIComponent_), "tryDecodeURIComponent");
var HonoRequest = /* @__PURE__ */ __name(class {
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = (key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  };
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
}, "HonoRequest");

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
}, "resolveCallback");

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var createResponseInstance = /* @__PURE__ */ __name((body, init) => new Response(body, init), "createResponseInstance");
var Context = /* @__PURE__ */ __name(class {
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = (layout) => this.#layout = layout;
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = () => this.#layout;
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = (name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  };
  status = (status) => {
    this.#status = status;
  };
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  };
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = (key) => {
    return this.#var ? this.#var.get(key) : void 0;
  };
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, { status, headers: responseHeaders });
  }
  newResponse = (...args) => this.#newResponse(...args);
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  };
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = (object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  };
  html = (html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = (location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  };
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = () => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  };
}, "Context");

// node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = /* @__PURE__ */ __name(class extends Error {
}, "UnsupportedPathError");

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err2, c) => {
  if ("getResponse" in err2) {
    const res = err2.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err2);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = /* @__PURE__ */ __name(class _Hono {
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = (handler) => {
    this.errorHandler = handler;
    return this;
  };
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = (handler) => {
    this.#notFoundHandler = handler;
    return this;
  };
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    }, "handler");
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = { basePath: this._basePath, path, method, handler };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err2, c) {
    if (err2 instanceof Error) {
      return this.errorHandler(err2, c);
    }
    throw err2;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err2) {
        return this.#handleError(err2, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err2) => this.#handleError(err2, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err2) {
        return this.#handleError(err2, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  };
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  };
}, "_Hono");

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }, "match2");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = /* @__PURE__ */ __name(class _Node {
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node();
        if (name !== "") {
          node.#varIndex = context.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node();
      }
    }
    node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
}, "_Node");

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = /* @__PURE__ */ __name(class {
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
}, "Trie");

// node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
__name(clearWildcardRegExpCache, "clearWildcardRegExpCache");
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
__name(buildMatcherFromPreprocessedRoutes, "buildMatcherFromPreprocessedRoutes");
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = /* @__PURE__ */ __name(class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
}, "RegExpRouter");

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = /* @__PURE__ */ __name(class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
}, "SmartRouter");

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = /* @__PURE__ */ __name((children) => {
  for (const _ in children) {
    return true;
  }
  return false;
}, "hasChildren");
var Node2 = /* @__PURE__ */ __name(class _Node2 {
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
}, "_Node");

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = /* @__PURE__ */ __name(class {
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
}, "TrieRouter");

// node_modules/hono/dist/hono.js
var Hono2 = /* @__PURE__ */ __name(class extends Hono {
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
}, "Hono");

// node_modules/hono/dist/middleware/cors/index.js
var cors = /* @__PURE__ */ __name((options) => {
  const defaults = {
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
    allowHeaders: [],
    exposeHeaders: []
  };
  const opts = {
    ...defaults,
    ...options
  };
  const findAllowOrigin = ((optsOrigin) => {
    if (typeof optsOrigin === "string") {
      if (optsOrigin === "*") {
        if (opts.credentials) {
          return (origin) => origin || null;
        }
        return () => optsOrigin;
      } else {
        return (origin) => optsOrigin === origin ? origin : null;
      }
    } else if (typeof optsOrigin === "function") {
      return optsOrigin;
    } else {
      return (origin) => optsOrigin.includes(origin) ? origin : null;
    }
  })(opts.origin);
  const findAllowMethods = ((optsAllowMethods) => {
    if (typeof optsAllowMethods === "function") {
      return optsAllowMethods;
    } else if (Array.isArray(optsAllowMethods)) {
      return () => optsAllowMethods;
    } else {
      return () => [];
    }
  })(opts.allowMethods);
  return /* @__PURE__ */ __name(async function cors2(c, next) {
    function set(key, value) {
      c.res.headers.set(key, value);
    }
    __name(set, "set");
    const allowOrigin = await findAllowOrigin(c.req.header("origin") || "", c);
    if (allowOrigin) {
      set("Access-Control-Allow-Origin", allowOrigin);
    }
    if (opts.credentials) {
      set("Access-Control-Allow-Credentials", "true");
    }
    if (opts.exposeHeaders?.length) {
      set("Access-Control-Expose-Headers", opts.exposeHeaders.join(","));
    }
    if (c.req.method === "OPTIONS") {
      if (opts.origin !== "*" || opts.credentials) {
        set("Vary", "Origin");
      }
      if (opts.maxAge != null) {
        set("Access-Control-Max-Age", opts.maxAge.toString());
      }
      const allowMethods = await findAllowMethods(c.req.header("origin") || "", c);
      if (allowMethods.length) {
        set("Access-Control-Allow-Methods", allowMethods.join(","));
      }
      let headers = opts.allowHeaders;
      if (!headers?.length) {
        const requestHeaders = c.req.header("Access-Control-Request-Headers");
        if (requestHeaders) {
          headers = requestHeaders.split(/\s*,\s*/);
        }
      }
      if (headers?.length) {
        set("Access-Control-Allow-Headers", headers.join(","));
        c.res.headers.append("Vary", "Access-Control-Request-Headers");
      }
      c.res.headers.delete("Content-Length");
      c.res.headers.delete("Content-Type");
      return new Response(null, {
        headers: c.res.headers,
        status: 204,
        statusText: "No Content"
      });
    }
    await next();
    if (opts.origin !== "*" || opts.credentials) {
      c.header("Vary", "Origin", { append: true });
    }
  }, "cors2");
}, "cors");

// node_modules/hono/dist/utils/color.js
function getColorEnabled() {
  const { process, Deno } = globalThis;
  const isNoColor = typeof Deno?.noColor === "boolean" ? Deno.noColor : process !== void 0 ? (
    // eslint-disable-next-line no-unsafe-optional-chaining
    "NO_COLOR" in process?.env
  ) : false;
  return !isNoColor;
}
__name(getColorEnabled, "getColorEnabled");
async function getColorEnabledAsync() {
  const { navigator } = globalThis;
  const cfWorkers = "cloudflare:workers";
  const isNoColor = navigator !== void 0 && navigator.userAgent === "Cloudflare-Workers" ? await (async () => {
    try {
      return "NO_COLOR" in ((await import(cfWorkers)).env ?? {});
    } catch {
      return false;
    }
  })() : !getColorEnabled();
  return !isNoColor;
}
__name(getColorEnabledAsync, "getColorEnabledAsync");

// node_modules/hono/dist/middleware/logger/index.js
var humanize = /* @__PURE__ */ __name((times) => {
  const [delimiter, separator] = [",", "."];
  const orderTimes = times.map((v) => v.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1" + delimiter));
  return orderTimes.join(separator);
}, "humanize");
var time = /* @__PURE__ */ __name((start) => {
  const delta = Date.now() - start;
  return humanize([delta < 1e3 ? delta + "ms" : Math.round(delta / 1e3) + "s"]);
}, "time");
var colorStatus = /* @__PURE__ */ __name(async (status) => {
  const colorEnabled = await getColorEnabledAsync();
  if (colorEnabled) {
    switch (status / 100 | 0) {
      case 5:
        return `\x1B[31m${status}\x1B[0m`;
      case 4:
        return `\x1B[33m${status}\x1B[0m`;
      case 3:
        return `\x1B[36m${status}\x1B[0m`;
      case 2:
        return `\x1B[32m${status}\x1B[0m`;
    }
  }
  return `${status}`;
}, "colorStatus");
async function log(fn, prefix, method, path, status = 0, elapsed) {
  const out = prefix === "<--" ? `${prefix} ${method} ${path}` : `${prefix} ${method} ${path} ${await colorStatus(status)} ${elapsed}`;
  fn(out);
}
__name(log, "log");
var logger = /* @__PURE__ */ __name((fn = console.log) => {
  return /* @__PURE__ */ __name(async function logger2(c, next) {
    const { method, url } = c.req;
    const path = url.slice(url.indexOf("/", 8));
    await log(fn, "<--", method, path);
    const start = Date.now();
    await next();
    await log(fn, "-->", method, path, c.res.status, time(start));
  }, "logger2");
}, "logger");

// src/utils/jwt.ts
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(base64url, "base64url");
function base64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(base64urlDecode, "base64urlDecode");
async function getKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
__name(getKey, "getKey");
async function signJWT(payload, secret, expiresInHours = 12) {
  const header = { alg: "HS256", typ: "JWT" };
  const now2 = Math.floor(Date.now() / 1e3);
  const fullPayload = {
    ...payload,
    iat: now2,
    exp: now2 + expiresInHours * 3600
  };
  const h = base64url(encoder.encode(JSON.stringify(header)));
  const p = base64url(encoder.encode(JSON.stringify(fullPayload)));
  const data = encoder.encode(`${h}.${p}`);
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return `${h}.${p}.${base64url(sig)}`;
}
__name(signJWT, "signJWT");
async function verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s)
      return null;
    const key = await getKey(secret);
    const data = encoder.encode(`${h}.${p}`);
    const sig = base64urlDecode(s);
    const valid = await crypto.subtle.verify("HMAC", key, sig, data);
    if (!valid)
      return null;
    const payload = JSON.parse(decoder.decode(base64urlDecode(p)));
    if (payload.exp < Math.floor(Date.now() / 1e3))
      return null;
    return payload;
  } catch {
    return null;
  }
}
__name(verifyJWT, "verifyJWT");

// src/utils/helpers.ts
var newId = /* @__PURE__ */ __name(() => crypto.randomUUID(), "newId");
var now = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
var ok = /* @__PURE__ */ __name((data, message) => ({ success: true, data, message }), "ok");
var err = /* @__PURE__ */ __name((error) => ({ success: false, error }), "err");
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const hashArr = Array.from(new Uint8Array(bits));
  const saltArr = Array.from(salt);
  const toHex = /* @__PURE__ */ __name((arr) => arr.map((b) => b.toString(16).padStart(2, "0")).join(""), "toHex");
  return `${toHex(saltArr)}:${toHex(hashArr)}`;
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, stored) {
  try {
    const [saltHex, hashHex] = stored.split(":");
    if (!saltHex || !hashHex)
      return false;
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" },
      keyMaterial,
      256
    );
    const computed = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return computed === hashHex;
  } catch {
    return false;
  }
}
__name(verifyPassword, "verifyPassword");
function generateToken() {
  const arr = crypto.getRandomValues(new Uint32Array(1));
  return String(arr[0] % 1e6).padStart(6, "0");
}
__name(generateToken, "generateToken");
function parseSesiJam(sesiTes) {
  if (!sesiTes)
    return null;
  const match2 = sesiTes.match(/\((\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/);
  if (!match2)
    return null;
  const pad = /* @__PURE__ */ __name((n) => n.padStart(2, "0"), "pad");
  return {
    jamMulai: `${pad(match2[1])}:${match2[2]}`,
    jamSelesai: `${pad(match2[3])}:${match2[4]}`
  };
}
__name(parseSesiJam, "parseSesiJam");
function cekJadwal(tanggalTes, jamMulai, jamSelesai, nowIso) {
  if (!tanggalTes || !jamMulai || !jamSelesai)
    return "aktif";
  const nowDate = nowIso ? new Date(nowIso) : /* @__PURE__ */ new Date();
  const toWIBTimestamp = /* @__PURE__ */ __name((date, time2) => {
    const [h, m] = time2.split(":").map(Number);
    const [y, mo, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, d, h - 7, m, 0)).getTime();
  }, "toWIBTimestamp");
  const mulai = toWIBTimestamp(tanggalTes, jamMulai);
  const selesai = toWIBTimestamp(tanggalTes, jamSelesai);
  const now2 = nowDate.getTime();
  if (now2 < mulai)
    return "belum";
  if (now2 > selesai)
    return "selesai";
  return "aktif";
}
__name(cekJadwal, "cekJadwal");
function buildRandomMaps(questions, randomizeQuestions, randomizeOptions) {
  const qList = randomizeQuestions ? shuffle([...questions]) : questions;
  const questionMap = qList.map((q) => q.id);
  const optionMap = {};
  for (const q of qList) {
    optionMap[q.id] = randomizeOptions ? shuffle(q.options.map((o) => o.id)) : q.options.map((o) => o.id);
  }
  return { questionMap, optionMap };
}
__name(buildRandomMaps, "buildRandomMaps");
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
__name(shuffle, "shuffle");

// node_modules/hono/dist/helper/factory/index.js
var createMiddleware = /* @__PURE__ */ __name((middleware) => middleware, "createMiddleware");

// src/middleware/auth.ts
var authMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer "))
    return c.json({ success: false, error: "Token tidak ditemukan" }, 401);
  const payload = await verifyJWT(header.slice(7), c.env.JWT_SECRET);
  if (!payload)
    return c.json({ success: false, error: "Token tidak valid atau sudah kedaluwarsa" }, 401);
  c.set("user", payload);
  await next();
});
function requireRole(...roles) {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");
    if (!user || !roles.includes(user.role))
      return c.json({ success: false, error: "Akses ditolak" }, 403);
    await next();
  });
}
__name(requireRole, "requireRole");

// src/routes/auth.ts
var auth = new Hono2();
auth.post("/login", async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password)
    return c.json(err("Username dan password wajib diisi"), 400);
  const uname = username.trim();
  const pwd = password.trim();
  const admin2 = await c.env.DB.prepare(
    "SELECT id, username, password, nama_lengkap FROM admins WHERE username = ?"
  ).bind(uname).first();
  if (admin2) {
    let valid = false;
    if (admin2.password.includes(":")) {
      valid = await verifyPassword(pwd, admin2.password);
    } else {
      valid = admin2.password === pwd;
    }
    if (!valid)
      return c.json(err("Username atau password salah"), 401);
    const token = await signJWT({
      sub: admin2.id,
      username: admin2.username,
      role: "admin",
      room_id: null,
      full_name: admin2.nama_lengkap || "Admin",
      source: "admins"
    }, c.env.JWT_SECRET);
    return c.json(ok({
      token,
      user: { id: admin2.id, username: admin2.username, full_name: admin2.nama_lengkap, role: "admin", room_id: null, source: "admins" }
    }, "Login berhasil"));
  }
  const cbtUser = await c.env.DB.prepare(
    "SELECT * FROM cbt_users WHERE username = ? AND is_active = 1"
  ).bind(uname).first();
  if (cbtUser) {
    let valid = false;
    if (cbtUser.password_hash?.includes(":")) {
      valid = await verifyPassword(pwd, cbtUser.password_hash);
    } else {
      valid = cbtUser.password_hash === pwd;
    }
    if (!valid)
      return c.json(err("Username atau password salah"), 401);
    const token = await signJWT({
      sub: cbtUser.id,
      username: cbtUser.username,
      role: cbtUser.role,
      room_id: cbtUser.room_id,
      full_name: cbtUser.nama_lengkap,
      source: "cbt_user"
    }, c.env.JWT_SECRET);
    return c.json(ok({
      token,
      user: { id: cbtUser.id, username: cbtUser.username, full_name: cbtUser.nama_lengkap, role: cbtUser.role, room_id: cbtUser.room_id, source: "cbt_user" }
    }, "Login berhasil"));
  }
  const pendaftar = await c.env.DB.prepare(
    "SELECT id, nisn, nama_lengkap, tanggal_lahir, ruang_tes, no_pendaftaran FROM pendaftar WHERE nisn = ?"
  ).bind(uname).first();
  if (pendaftar) {
    const tgl = pendaftar.tanggal_lahir || "";
    let expectedPwd = "";
    if (tgl.match(/^\d{4}-\d{2}-\d{2}/)) {
      const [y, m, d] = tgl.split(/[-T]/);
      expectedPwd = `${d}${m}${y}`;
    } else if (tgl.match(/^\d{2}[-/]\d{2}[-/]\d{4}/)) {
      expectedPwd = tgl.replace(/[-/]/g, "");
    } else {
      expectedPwd = tgl.replace(/[-/\s]/g, "");
    }
    if (!expectedPwd || pwd !== expectedPwd) {
      return c.json(err("Username atau password salah"), 401);
    }
    let roomId = null;
    if (pendaftar.ruang_tes) {
      const room = await c.env.DB.prepare(
        "SELECT id FROM cbt_rooms WHERE room_name = ?"
      ).bind(pendaftar.ruang_tes).first();
      if (room)
        roomId = room.id;
    }
    const token = await signJWT({
      sub: pendaftar.id,
      username: pendaftar.nisn,
      role: "student",
      room_id: roomId,
      full_name: pendaftar.nama_lengkap,
      source: "pendaftar"
    }, c.env.JWT_SECRET);
    return c.json(ok({
      token,
      user: { id: pendaftar.id, username: pendaftar.nisn, full_name: pendaftar.nama_lengkap, role: "student", room_id: roomId, source: "pendaftar", no_pendaftaran: pendaftar.no_pendaftaran }
    }, "Login berhasil"));
  }
  return c.json(err("Username atau password salah"), 401);
});
auth.get("/me", authMiddleware, (c) => {
  return c.json(ok(c.get("user")));
});
var auth_default = auth;

// src/routes/admin.ts
var admin = new Hono2();
admin.use("*", authMiddleware, requireRole("admin"));
admin.get("/rooms", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.*,
       (SELECT COUNT(*) FROM pendaftar p WHERE p.ruang_tes = r.room_name) as jumlah_peserta,
       (SELECT GROUP_CONCAT(cu.nama_lengkap, ', ') FROM cbt_users cu WHERE cu.room_id = r.id AND cu.role = 'proctor') as proctor_names
     FROM cbt_rooms r ORDER BY r.room_name`
  ).all();
  return c.json(ok(results));
});
admin.post("/rooms/sync", async (c) => {
  const { results: rooms } = await c.env.DB.prepare(
    `SELECT DISTINCT ruang_tes FROM pendaftar WHERE ruang_tes IS NOT NULL AND ruang_tes != '' ORDER BY ruang_tes`
  ).all();
  let created = 0;
  for (const r of rooms) {
    const exists = await c.env.DB.prepare(
      "SELECT id FROM cbt_rooms WHERE room_name = ?"
    ).bind(r.ruang_tes).first();
    if (!exists) {
      await c.env.DB.prepare("INSERT INTO cbt_rooms (id, room_name, capacity) VALUES (?,?,40)").bind(newId(), r.ruang_tes).run();
      created++;
    }
  }
  return c.json(ok({ synced: rooms.length, created }, `${created} ruangan baru ditambahkan`));
});
admin.post("/rooms", async (c) => {
  const { room_name, capacity } = await c.req.json();
  const id = newId();
  await c.env.DB.prepare("INSERT INTO cbt_rooms (id, room_name, capacity) VALUES (?,?,?)").bind(id, room_name, capacity || 40).run();
  return c.json(ok({ id }, "Ruangan ditambahkan"), 201);
});
admin.put("/rooms/:id", async (c) => {
  const { room_name, capacity } = await c.req.json();
  await c.env.DB.prepare("UPDATE cbt_rooms SET room_name=?, capacity=? WHERE id=?").bind(room_name, capacity, c.req.param("id")).run();
  return c.json(ok(null, "Ruangan diperbarui"));
});
admin.delete("/rooms/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM cbt_rooms WHERE id=?").bind(c.req.param("id")).run();
  return c.json(ok(null, "Ruangan dihapus"));
});
admin.get("/proctors", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cu.id, cu.username, cu.nama_lengkap as full_name, cu.room_id,
       r.room_name
     FROM cbt_users cu
     LEFT JOIN cbt_rooms r ON r.id = cu.room_id
     WHERE cu.role = 'proctor' AND cu.is_active = 1
     ORDER BY cu.nama_lengkap`
  ).all();
  return c.json(ok(results));
});
admin.put("/proctors/:id/assign", async (c) => {
  const { room_id } = await c.req.json();
  await c.env.DB.prepare("UPDATE cbt_users SET room_id=?, updated_at=? WHERE id=? AND role=?").bind(room_id || null, now(), c.req.param("id"), "proctor").run();
  return c.json(ok(null, "Proktor berhasil di-assign"));
});
admin.get("/users", async (c) => {
  const role = c.req.query("role");
  const room_id = c.req.query("room_id");
  if (role === "admin") {
    const { results: results2 } = await c.env.DB.prepare(
      `SELECT id, username, nama_lengkap as full_name, 'admin' as role, NULL as room_id, NULL as nisn, 1 as is_active FROM admins ORDER BY nama_lengkap`
    ).all();
    return c.json(ok(results2));
  }
  let sql = `SELECT id, username, nama_lengkap as full_name, role, room_id, nisn, is_active, 'cbt_user' as source FROM cbt_users`;
  const conditions = [];
  const params = [];
  if (role) {
    conditions.push("role = ?");
    params.push(role);
  }
  if (room_id) {
    conditions.push("room_id = ?");
    params.push(room_id);
  }
  if (conditions.length)
    sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY nama_lengkap";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  if (!role) {
    const { results: admins } = await c.env.DB.prepare(
      `SELECT id, username, nama_lengkap as full_name, 'admin' as role, NULL as room_id, NULL as nisn, 1 as is_active FROM admins ORDER BY nama_lengkap`
    ).all();
    return c.json(ok([...results, ...admins]));
  }
  return c.json(ok(results));
});
admin.post("/users", async (c) => {
  const body = await c.req.json();
  const { username, password, role, room_id, nisn } = body;
  const nama = body.full_name || body.nama_lengkap;
  if (!username || !password || !nama || !role)
    return c.json(err("Data tidak lengkap"), 400);
  try {
    const id = newId();
    if (role === "admin") {
      await c.env.DB.prepare(
        "INSERT INTO admins (id, username, password, nama_lengkap) VALUES (?,?,?,?)"
      ).bind(id, username, password, nama).run();
    } else {
      const hash = await hashPassword(password);
      await c.env.DB.prepare(
        "INSERT INTO cbt_users (id, username, password_hash, nama_lengkap, role, room_id, nisn) VALUES (?,?,?,?,?,?,?)"
      ).bind(id, username, hash, nama, role, room_id || null, nisn || null).run();
    }
    return c.json(ok({ id }, "User ditambahkan"), 201);
  } catch (e) {
    if (e.message?.includes("UNIQUE"))
      return c.json(err("Username sudah digunakan"), 409);
    throw e;
  }
});
admin.post("/users/bulk", async (c) => {
  const { users } = await c.req.json();
  if (!users?.length)
    return c.json(err("Data kosong"), 400);
  const stmt = c.env.DB.prepare(
    "INSERT OR IGNORE INTO cbt_users (id, username, password_hash, nama_lengkap, role, room_id, nisn) VALUES (?,?,?,?,?,?,?)"
  );
  const batch = [];
  for (const u of users) {
    const hash = await hashPassword(u.password || u.username);
    batch.push(stmt.bind(newId(), u.username, hash, u.full_name || u.nama_lengkap, u.role || "student", u.room_id || null, u.nisn || null));
  }
  for (let i = 0; i < batch.length; i += 100) {
    await c.env.DB.batch(batch.slice(i, i + 100));
  }
  return c.json(ok({ imported: users.length }, "Import user berhasil"));
});
admin.put("/users/:id", async (c) => {
  const body = await c.req.json();
  const nama = body.full_name || body.nama_lengkap;
  const id = c.req.param("id");
  if (body.role === "admin") {
    let sql = "UPDATE admins SET nama_lengkap=?";
    const params = [nama];
    if (body.password) {
      sql += ", password=?";
      params.push(body.password);
    }
    sql += " WHERE id=?";
    params.push(id);
    await c.env.DB.prepare(sql).bind(...params).run();
  } else {
    let sql = "UPDATE cbt_users SET nama_lengkap=?, role=?, room_id=?, nisn=?, is_active=?, updated_at=?";
    const params = [nama, body.role, body.room_id || null, body.nisn || null, body.is_active ?? 1, now()];
    if (body.password) {
      sql += ", password_hash=?";
      params.push(await hashPassword(body.password));
    }
    sql += " WHERE id=?";
    params.push(id);
    await c.env.DB.prepare(sql).bind(...params).run();
  }
  return c.json(ok(null, "User diperbarui"));
});
admin.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM cbt_users WHERE id=?").bind(id),
    c.env.DB.prepare("DELETE FROM admins WHERE id=?").bind(id)
  ]);
  return c.json(ok(null, "User dihapus"));
});
admin.get("/pendaftar", async (c) => {
  const room = c.req.query("ruang_tes");
  const jalur = c.req.query("jalur");
  let sql = `SELECT id, nisn, nama_lengkap, no_pendaftaran, ruang_tes, jalur, asal_sekolah,
            jenis_kelamin, tanggal_lahir, tanggal_tes, sesi_tes,
            status_verifikasi, status_kelulusan
     FROM pendaftar`;
  const conditions = [];
  const params = [];
  if (room) {
    conditions.push("ruang_tes = ?");
    params.push(room);
  }
  if (jalur) {
    conditions.push("LOWER(jalur) = LOWER(?)");
    params.push(jalur);
  }
  if (conditions.length)
    sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY ruang_tes, nama_lengkap";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(ok(results));
});
admin.delete("/pendaftar/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM pendaftar WHERE id = ?").bind(c.req.param("id")).run();
  return c.json(ok(null, "Peserta berhasil dihapus"));
});
admin.put("/pendaftar/:id/ruang", async (c) => {
  const { ruang_tes } = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE pendaftar SET ruang_tes = ? WHERE id = ?"
  ).bind(ruang_tes || null, c.req.param("id")).run();
  return c.json(ok(null, "Ruangan berhasil diperbarui"));
});
admin.get("/pendaftar/stats", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       COUNT(ruang_tes) as assigned_room,
       COUNT(DISTINCT ruang_tes) as total_rooms,
       COUNT(tanggal_tes) as has_schedule
     FROM pendaftar`
  ).first();
  return c.json(ok(results));
});
admin.get("/exams", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, COUNT(q.id) as question_count
     FROM cbt_exams e LEFT JOIN cbt_questions q ON q.exam_id = e.id
     GROUP BY e.id ORDER BY e.created_at DESC`
  ).all();
  return c.json(ok(results));
});
admin.get("/exams/:id", async (c) => {
  const exam = await c.env.DB.prepare("SELECT * FROM cbt_exams WHERE id=?").bind(c.req.param("id")).first();
  if (!exam)
    return c.json(err("Ujian tidak ditemukan"), 404);
  return c.json(ok(exam));
});
admin.post("/exams", async (c) => {
  const b = await c.req.json();
  const user = c.get("user");
  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO cbt_exams (id, title, description, duration_minutes, rules_text, completion_message,
     is_score_visible, randomize_questions, randomize_options, active_status, passing_score, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id,
    b.title,
    b.description || null,
    b.duration_minutes || 60,
    b.rules_text || null,
    b.completion_message || "Ujian telah selesai. Terima kasih.",
    b.is_score_visible ? 1 : 0,
    b.randomize_questions ? 1 : 0,
    b.randomize_options ? 1 : 0,
    b.active_status || "draft",
    b.passing_score || 0,
    user.sub
  ).run();
  return c.json(ok({ id }, "Ujian dibuat"), 201);
});
admin.put("/exams/:id", async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE cbt_exams SET title=?, description=?, duration_minutes=?, rules_text=?,
     completion_message=?, is_score_visible=?, randomize_questions=?, randomize_options=?,
     active_status=?, passing_score=?, updated_at=? WHERE id=?`
  ).bind(
    b.title,
    b.description,
    b.duration_minutes,
    b.rules_text,
    b.completion_message,
    b.is_score_visible ? 1 : 0,
    b.randomize_questions ? 1 : 0,
    b.randomize_options ? 1 : 0,
    b.active_status,
    b.passing_score || 0,
    now(),
    c.req.param("id")
  ).run();
  return c.json(ok(null, "Ujian diperbarui"));
});
admin.delete("/exams/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM cbt_exams WHERE id=?").bind(c.req.param("id")).run();
  return c.json(ok(null, "Ujian dihapus"));
});
admin.get("/exams/:examId/questions", async (c) => {
  const examId = c.req.param("examId");
  const { results: questions } = await c.env.DB.prepare(
    "SELECT * FROM cbt_questions WHERE exam_id=? ORDER BY question_order"
  ).bind(examId).all();
  const qIds = questions.map((q) => q.id);
  if (qIds.length === 0)
    return c.json(ok([]));
  const ph = qIds.map(() => "?").join(",");
  const { results: options } = await c.env.DB.prepare(
    `SELECT * FROM cbt_question_options WHERE question_id IN (${ph}) ORDER BY option_order`
  ).bind(...qIds).all();
  const optMap = {};
  for (const o of options) {
    if (!optMap[o.question_id])
      optMap[o.question_id] = [];
    optMap[o.question_id].push(o);
  }
  return c.json(ok(questions.map((q) => ({ ...q, options: optMap[q.id] || [] }))));
});
admin.post("/exams/:examId/questions", async (c) => {
  const examId = c.req.param("examId");
  const { question_text, question_type, question_order, image_url, audio_url, points, options } = await c.req.json();
  const qId = newId();
  await c.env.DB.prepare(
    `INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order, image_url, audio_url, points) VALUES (?,?,?,?,?,?,?,?)`
  ).bind(qId, examId, question_text, question_type || "multiple_choice", question_order || 0, image_url || null, audio_url || null, points || 1).run();
  if (options?.length) {
    const stmts = options.map(
      (o, i) => c.env.DB.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order) VALUES (?,?,?,?,?,?,?)").bind(newId(), qId, o.option_label, o.option_text, o.image_url || null, o.is_correct ? 1 : 0, i)
    );
    await c.env.DB.batch(stmts);
  }
  return c.json(ok({ id: qId }, "Soal ditambahkan"), 201);
});
admin.post("/exams/:examId/questions/bulk", async (c) => {
  const examId = c.req.param("examId");
  const { questions } = await c.req.json();
  for (const q of questions) {
    const qId = newId();
    await c.env.DB.prepare(
      `INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order, image_url, audio_url, points) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(qId, examId, q.question_text, q.question_type || "multiple_choice", q.question_order || 0, q.image_url || null, q.audio_url || null, q.points || 1).run();
    if (q.options?.length) {
      const stmts = q.options.map(
        (o, i) => c.env.DB.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order) VALUES (?,?,?,?,?,?,?)").bind(newId(), qId, o.option_label, o.option_text, o.image_url || null, o.is_correct ? 1 : 0, i)
      );
      await c.env.DB.batch(stmts);
    }
  }
  return c.json(ok({ imported: questions.length }, "Soal berhasil diimport"));
});
admin.put("/questions/:id", async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE cbt_questions SET question_text=?, question_type=?, question_order=?, image_url=?, audio_url=?, points=? WHERE id=?`
  ).bind(b.question_text, b.question_type, b.question_order, b.image_url || null, b.audio_url || null, b.points || 1, c.req.param("id")).run();
  if (b.options) {
    await c.env.DB.prepare("DELETE FROM cbt_question_options WHERE question_id=?").bind(c.req.param("id")).run();
    const stmts = b.options.map(
      (o, i) => c.env.DB.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order) VALUES (?,?,?,?,?,?,?)").bind(newId(), c.req.param("id"), o.option_label, o.option_text, o.image_url || null, o.is_correct ? 1 : 0, i)
    );
    await c.env.DB.batch(stmts);
  }
  return c.json(ok(null, "Soal diperbarui"));
});
admin.delete("/questions/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM cbt_questions WHERE id=?").bind(c.req.param("id")).run();
  return c.json(ok(null, "Soal dihapus"));
});
admin.get("/exams/:examId/tokens", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT et.*, r.room_name FROM cbt_exam_tokens et JOIN cbt_rooms r ON r.id = et.room_id WHERE et.exam_id=? ORDER BY r.room_name`
  ).bind(c.req.param("examId")).all();
  return c.json(ok(results));
});
admin.post("/exams/:examId/tokens/generate", async (c) => {
  const examId = c.req.param("examId");
  const { room_ids } = await c.req.json();
  const targetRooms = room_ids?.length ? room_ids : (await c.env.DB.prepare("SELECT id FROM cbt_rooms").all()).results.map((r) => r.id);
  const stmts = targetRooms.map(
    (rid) => c.env.DB.prepare("INSERT OR REPLACE INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active) VALUES (?,?,?,?,1)").bind(newId(), examId, rid, generateToken())
  );
  for (let i = 0; i < stmts.length; i += 100) {
    await c.env.DB.batch(stmts.slice(i, i + 100));
  }
  return c.json(ok({ generated: targetRooms.length }, "Token berhasil digenerate"));
});
admin.post("/upload", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string")
    return c.json(err("File tidak ditemukan"), 400);
  const ext = file.name.split(".").pop() || "bin";
  const key = `media/${Date.now()}-${newId().slice(0, 8)}.${ext}`;
  await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return c.json(ok({ key, url: `/r2/${key}` }, "Upload berhasil"));
});
admin.get("/exams/:examId/results", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT er.*,
       COALESCE(p.nama_lengkap, cu.nama_lengkap) as full_name,
       COALESCE(p.nisn, cu.nisn) as nisn,
       COALESCE(p.nisn, cu.username) as username,
       r.room_name
     FROM cbt_exam_results er
     JOIN cbt_exam_sessions es ON es.id = er.session_id
     JOIN cbt_rooms r ON r.id = es.room_id
     LEFT JOIN pendaftar p ON er.user_id = p.id AND er.user_type = 'pendaftar'
     LEFT JOIN cbt_users cu ON er.user_id = cu.id AND er.user_type = 'cbt_user'
     WHERE er.exam_id = ?
     ORDER BY r.room_name, full_name`
  ).bind(c.req.param("examId")).all();
  return c.json(ok(results));
});
admin.get("/exams/:examId/sessions", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT es.*,
       COALESCE(p.nama_lengkap, cu.nama_lengkap) as full_name,
       COALESCE(p.nisn, cu.nisn) as nisn,
       COALESCE(p.nisn, cu.username) as username,
       r.room_name
     FROM cbt_exam_sessions es
     JOIN cbt_rooms r ON r.id = es.room_id
     LEFT JOIN pendaftar p ON es.user_id = p.id AND es.user_type = 'pendaftar'
     LEFT JOIN cbt_users cu ON es.user_id = cu.id AND es.user_type = 'cbt_user'
     WHERE es.exam_id = ?
     ORDER BY r.room_name, full_name`
  ).bind(c.req.param("examId")).all();
  return c.json(ok(results));
});
var admin_default = admin;

// src/routes/proctor.ts
var proctor = new Hono2();
proctor.use("*", authMiddleware, requireRole("proctor"));
proctor.get("/token", async (c) => {
  const user = c.get("user");
  if (!user.room_id)
    return c.json(err("Anda belum di-assign ke ruangan"), 400);
  const { results } = await c.env.DB.prepare(
    `SELECT et.*, e.title as exam_title, r.room_name
     FROM cbt_exam_tokens et
     JOIN cbt_exams e ON e.id = et.exam_id
     JOIN cbt_rooms r ON r.id = et.room_id
     WHERE et.room_id = ? AND et.is_active = 1 AND e.active_status = 'active'
     ORDER BY e.title`
  ).bind(user.room_id).all();
  return c.json(ok(results));
});
proctor.get("/sessions", async (c) => {
  const user = c.get("user");
  if (!user.room_id)
    return c.json(err("Anda belum di-assign ke ruangan"), 400);
  const examId = c.req.query("exam_id");
  let sql = `
    SELECT es.id, es.exam_id, es.user_id, es.user_type, es.status, es.cheat_warnings,
           es.started_at, es.finished_at, es.last_heartbeat, es.device_id, es.is_time_locked,
           COALESCE(p.nama_lengkap, cu.nama_lengkap) as full_name,
           COALESCE(p.nisn, cu.nisn) as nisn,
           COALESCE(p.sesi_tes, '') as sesi_tes,
           e.title as exam_title,
           (SELECT COUNT(*) FROM cbt_student_answers sa WHERE sa.session_id = es.id) as answered_count,
           (SELECT COUNT(*) FROM cbt_questions q WHERE q.exam_id = es.exam_id) as total_questions
    FROM cbt_exam_sessions es
    JOIN cbt_exams e ON e.id = es.exam_id
    LEFT JOIN pendaftar p ON es.user_id = p.id AND es.user_type = 'pendaftar'
    LEFT JOIN cbt_users cu ON es.user_id = cu.id AND es.user_type = 'cbt_user'
    WHERE es.room_id = ?`;
  const params = [user.room_id];
  if (examId) {
    sql += " AND es.exam_id = ?";
    params.push(examId);
  }
  sql += " ORDER BY full_name";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  const enriched = results.map((s) => {
    const diff = Date.now() - new Date(s.last_heartbeat).getTime();
    let live_status = "offline";
    if (s.status === "submitted" || s.status === "force_submitted")
      live_status = "selesai";
    else if (s.is_time_locked)
      live_status = "dikunci";
    else if (diff < 3e4)
      live_status = "online";
    return { ...s, live_status };
  });
  return c.json(ok(enriched));
});
proctor.post("/sessions/:id/reset", async (c) => {
  const user = c.get("user");
  const session = await c.env.DB.prepare(
    "SELECT * FROM cbt_exam_sessions WHERE id = ? AND room_id = ?"
  ).bind(c.req.param("id"), user.room_id).first();
  if (!session)
    return c.json(err("Sesi tidak ditemukan di ruangan Anda"), 404);
  await c.env.DB.prepare(
    `UPDATE cbt_exam_sessions SET device_id = NULL, status = 'active', last_heartbeat = ? WHERE id = ?`
  ).bind(now(), c.req.param("id")).run();
  return c.json(ok(null, "Sesi berhasil direset"));
});
proctor.post("/sessions/:id/unlock", async (c) => {
  const user = c.get("user");
  const session = await c.env.DB.prepare(
    "SELECT * FROM cbt_exam_sessions WHERE id = ? AND room_id = ?"
  ).bind(c.req.param("id"), user.room_id).first();
  if (!session)
    return c.json(err("Sesi tidak ditemukan di ruangan Anda"), 404);
  if (session.status === "submitted" || session.status === "force_submitted")
    return c.json(err("Ujian sudah selesai, tidak bisa dibuka"), 400);
  await c.env.DB.prepare(
    `UPDATE cbt_exam_sessions SET is_time_locked = 0, last_heartbeat = ? WHERE id = ?`
  ).bind(now(), c.req.param("id")).run();
  return c.json(ok(null, "Sesi berhasil dibuka"));
});
var proctor_default = proctor;

// src/routes/student.ts
var student = new Hono2();
student.use("*", authMiddleware, requireRole("student"));
student.get("/exams", async (c) => {
  const user = c.get("user");
  const userType = user.source === "pendaftar" ? "pendaftar" : "cbt_user";
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.description, e.duration_minutes, e.rules_text, e.active_status,
            es.id as session_id, es.status as session_status, es.is_time_locked
     FROM cbt_exams e
     LEFT JOIN cbt_exam_sessions es ON es.exam_id = e.id AND es.user_id = ? AND es.user_type = ?
     WHERE e.active_status = 'active'
     ORDER BY e.title`
  ).bind(user.sub, userType).all();
  let jadwalData = null;
  if (userType === "pendaftar") {
    jadwalData = await c.env.DB.prepare(
      "SELECT sesi_tes, tanggal_tes FROM pendaftar WHERE id = ?"
    ).bind(user.sub).first() || null;
  }
  const enriched = results.map((exam) => {
    let jadwal_status = "no_schedule";
    let jadwal_info = null;
    if (exam.is_time_locked) {
      jadwal_status = "selesai";
      jadwal_info = "Waktu ujian dikunci oleh pengawas";
    } else if (jadwalData?.sesi_tes && jadwalData?.tanggal_tes) {
      const parsed = parseSesiJam(jadwalData.sesi_tes);
      if (parsed) {
        jadwal_status = cekJadwal(jadwalData.tanggal_tes, parsed.jamMulai, parsed.jamSelesai);
        const tgl = /* @__PURE__ */ new Date(jadwalData.tanggal_tes + "T00:00:00+07:00");
        const tglStr = tgl.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        jadwal_info = `${tglStr}, ${parsed.jamMulai}\u2013${parsed.jamSelesai} WIB`;
      }
    } else {
      jadwal_status = "aktif";
    }
    return { ...exam, jadwal_status, jadwal_info };
  });
  return c.json(ok(enriched));
});
student.post("/exams/:examId/validate-token", async (c) => {
  const examId = c.req.param("examId");
  const user = c.get("user");
  const { token_code, device_id } = await c.req.json();
  const userType = user.source === "pendaftar" ? "pendaftar" : "cbt_user";
  if (!user.room_id)
    return c.json(err("Anda belum di-assign ke ruangan"), 400);
  if (!token_code)
    return c.json(err("Token wajib diisi"), 400);
  if (!device_id)
    return c.json(err("Device ID diperlukan"), 400);
  if (userType === "pendaftar") {
    const jadwal = await c.env.DB.prepare(
      "SELECT sesi_tes, tanggal_tes FROM pendaftar WHERE id = ?"
    ).bind(user.sub).first();
    if (jadwal?.sesi_tes && jadwal?.tanggal_tes) {
      const parsed = parseSesiJam(jadwal.sesi_tes);
      if (parsed) {
        const status = cekJadwal(jadwal.tanggal_tes, parsed.jamMulai, parsed.jamSelesai);
        if (status === "belum")
          return c.json(err(`Ujian belum dimulai. Jadwal Anda: ${jadwal.sesi_tes}`), 403);
        if (status === "selesai")
          return c.json(err(`Waktu ujian Anda telah berakhir (${jadwal.sesi_tes})`), 403);
      }
    }
  }
  const tokenRow = await c.env.DB.prepare(
    `SELECT * FROM cbt_exam_tokens WHERE exam_id=? AND room_id=? AND token_code=? AND is_active=1`
  ).bind(examId, user.room_id, token_code).first();
  if (!tokenRow)
    return c.json(err("Token tidak valid atau sudah kedaluwarsa"), 401);
  const exam = await c.env.DB.prepare(
    `SELECT * FROM cbt_exams WHERE id=? AND active_status='active'`
  ).bind(examId).first();
  if (!exam)
    return c.json(err("Ujian tidak tersedia"), 404);
  const existing = await c.env.DB.prepare(
    "SELECT * FROM cbt_exam_sessions WHERE exam_id=? AND user_id=? AND user_type=?"
  ).bind(examId, user.sub, userType).first();
  if (existing) {
    if (existing.status === "submitted" || existing.status === "force_submitted")
      return c.json(err("Anda sudah menyelesaikan ujian ini"), 400);
    if (existing.is_time_locked)
      return c.json(err("Waktu ujian dikunci oleh pengawas. Hubungi pengawas untuk membuka."), 403);
    if (existing.device_id && existing.device_id !== device_id)
      return c.json(err("Sesi terkunci di perangkat lain. Hubungi pengawas untuk reset."), 403);
    await c.env.DB.prepare(
      "UPDATE cbt_exam_sessions SET device_id=?, last_heartbeat=?, is_time_locked=0 WHERE id=?"
    ).bind(device_id, now(), existing.id).run();
    return c.json(ok({
      session_id: existing.id,
      resumed: true,
      question_map: JSON.parse(existing.question_map || "[]"),
      option_map: JSON.parse(existing.option_map || "{}"),
      started_at: existing.started_at,
      duration_minutes: exam.duration_minutes
    }, "Sesi dilanjutkan"));
  }
  const { results: questions } = await c.env.DB.prepare(
    "SELECT id FROM cbt_questions WHERE exam_id=? ORDER BY question_order"
  ).bind(examId).all();
  const qIds = questions.map((q) => q.id);
  const { results: allOpts } = await c.env.DB.prepare(
    `SELECT qo.id, qo.question_id FROM cbt_question_options qo
     JOIN cbt_questions q ON q.id = qo.question_id WHERE q.exam_id=? ORDER BY qo.option_order`
  ).bind(examId).all();
  const optsByQ = {};
  for (const o of allOpts) {
    if (!optsByQ[o.question_id])
      optsByQ[o.question_id] = [];
    optsByQ[o.question_id].push({ id: o.id });
  }
  const qData = qIds.map((id) => ({ id, options: optsByQ[id] || [] }));
  const { questionMap, optionMap } = buildRandomMaps(qData, !!exam.randomize_questions, !!exam.randomize_options);
  const sessionId = newId();
  await c.env.DB.prepare(
    `INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, device_id, question_map, option_map, ip_address, user_agent)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    sessionId,
    examId,
    user.sub,
    userType,
    user.room_id,
    device_id,
    JSON.stringify(questionMap),
    JSON.stringify(optionMap),
    c.req.header("CF-Connecting-IP") || "",
    c.req.header("User-Agent") || ""
  ).run();
  return c.json(ok({
    session_id: sessionId,
    resumed: false,
    question_map: questionMap,
    option_map: optionMap,
    started_at: now(),
    duration_minutes: exam.duration_minutes
  }, "Ujian dimulai"), 201);
});
student.get("/sessions/:sessionId/questions", async (c) => {
  const user = c.get("user");
  const session = await c.env.DB.prepare(
    "SELECT * FROM cbt_exam_sessions WHERE id=? AND user_id=?"
  ).bind(c.req.param("sessionId"), user.sub).first();
  if (!session)
    return c.json(err("Sesi tidak ditemukan"), 404);
  if (session.status === "submitted" || session.status === "force_submitted")
    return c.json(err("Ujian sudah selesai"), 400);
  if (session.is_time_locked)
    return c.json(err("Waktu ujian dikunci oleh pengawas"), 403);
  const qMap = JSON.parse(session.question_map || "[]");
  const oMap = JSON.parse(session.option_map || "{}");
  const { results: questions } = await c.env.DB.prepare(
    "SELECT id, question_text, question_type, image_url, audio_url, points FROM cbt_questions WHERE exam_id=?"
  ).bind(session.exam_id).all();
  const qById = new Map(questions.map((q) => [q.id, q]));
  const qIds = questions.map((q) => q.id);
  const ph = qIds.map(() => "?").join(",");
  const { results: options } = await c.env.DB.prepare(
    `SELECT id, question_id, option_label, option_text, image_url FROM cbt_question_options WHERE question_id IN (${ph})`
  ).bind(...qIds).all();
  const oByQ = /* @__PURE__ */ new Map();
  for (const o of options) {
    if (!oByQ.has(o.question_id))
      oByQ.set(o.question_id, []);
    oByQ.get(o.question_id).push(o);
  }
  const ordered = qMap.map((qId, idx) => {
    const q = qById.get(qId);
    const oIds = oMap[qId] || [];
    const oAll = oByQ.get(qId) || [];
    const oById = new Map(oAll.map((o) => [o.id, o]));
    const orderedOpts = oIds.length > 0 ? oIds.map((id) => oById.get(id)).filter(Boolean) : oAll;
    return {
      index: idx,
      id: q.id,
      question_text: q.question_text,
      question_type: q.question_type,
      image_url: q.image_url,
      audio_url: q.audio_url,
      options: orderedOpts
    };
  });
  const { results: answers } = await c.env.DB.prepare(
    "SELECT question_id, selected_option_id, essay_answer, is_doubtful FROM cbt_student_answers WHERE session_id=?"
  ).bind(c.req.param("sessionId")).all();
  return c.json(ok({ questions: ordered, answers }));
});
student.post("/sessions/:sessionId/answers", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");
  const { answers } = await c.req.json();
  const session = await c.env.DB.prepare(
    "SELECT id, status, is_time_locked FROM cbt_exam_sessions WHERE id=? AND user_id=?"
  ).bind(sessionId, user.sub).first();
  if (!session || session.status === "submitted" || session.status === "force_submitted")
    return c.json(err("Sesi tidak aktif"), 400);
  if (session.is_time_locked)
    return c.json(err("Waktu ujian dikunci"), 403);
  if (!answers?.length)
    return c.json(ok(null));
  const stmts = answers.map(
    (a) => c.env.DB.prepare(
      `INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id, essay_answer, is_doubtful, answered_at)
       VALUES (?,?,?,?,?,?,?) ON CONFLICT(session_id, question_id) DO UPDATE SET
       selected_option_id=excluded.selected_option_id, essay_answer=excluded.essay_answer,
       is_doubtful=excluded.is_doubtful, answered_at=excluded.answered_at`
    ).bind(newId(), sessionId, a.question_id, a.selected_option_id || null, a.essay_answer || null, a.is_doubtful ? 1 : 0, now())
  );
  for (let i = 0; i < stmts.length; i += 100) {
    await c.env.DB.batch(stmts.slice(i, i + 100));
  }
  await c.env.DB.prepare("UPDATE cbt_exam_sessions SET last_heartbeat=? WHERE id=?").bind(now(), sessionId).run();
  return c.json(ok(null, "Jawaban tersimpan"));
});
student.post("/sessions/:sessionId/heartbeat", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");
  const userType = user.source === "pendaftar" ? "pendaftar" : "cbt_user";
  await c.env.DB.prepare(
    "UPDATE cbt_exam_sessions SET last_heartbeat=? WHERE id=? AND user_id=?"
  ).bind(now(), sessionId, user.sub).run();
  if (userType === "pendaftar") {
    const jadwal = await c.env.DB.prepare(
      "SELECT sesi_tes, tanggal_tes FROM pendaftar WHERE id = ?"
    ).bind(user.sub).first();
    if (jadwal?.sesi_tes && jadwal?.tanggal_tes) {
      const parsed = parseSesiJam(jadwal.sesi_tes);
      if (parsed && cekJadwal(jadwal.tanggal_tes, parsed.jamMulai, parsed.jamSelesai) === "selesai") {
        await c.env.DB.prepare(
          "UPDATE cbt_exam_sessions SET is_time_locked=1 WHERE id=? AND is_time_locked=0"
        ).bind(sessionId).run();
        return c.json(ok({ time_locked: true }, "Waktu ujian berakhir"));
      }
    }
  }
  return c.json(ok({ time_locked: false }));
});
student.post("/sessions/:sessionId/cheat", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");
  const session = await c.env.DB.prepare(
    "SELECT * FROM cbt_exam_sessions WHERE id=? AND user_id=?"
  ).bind(sessionId, user.sub).first();
  if (!session)
    return c.json(err("Sesi tidak ditemukan"), 404);
  const newW = (session.cheat_warnings || 0) + 1;
  const autoSubmit = newW >= 3;
  await c.env.DB.prepare(
    `UPDATE cbt_exam_sessions SET cheat_warnings=?, status=?, ${autoSubmit ? "finished_at=?," : ""} last_heartbeat=? WHERE id=?`
  ).bind(newW, autoSubmit ? "force_submitted" : "active", ...autoSubmit ? [now()] : [], now(), sessionId).run();
  if (autoSubmit)
    await computeScore(c.env.DB, sessionId, session.exam_id, session.user_id, session.user_type);
  return c.json(ok({ warnings: newW, auto_submitted: autoSubmit }));
});
student.post("/sessions/:sessionId/submit", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");
  const session = await c.env.DB.prepare(
    "SELECT * FROM cbt_exam_sessions WHERE id=? AND user_id=?"
  ).bind(sessionId, user.sub).first();
  if (!session)
    return c.json(err("Sesi tidak ditemukan"), 404);
  if (session.status === "submitted" || session.status === "force_submitted")
    return c.json(err("Ujian sudah diselesaikan"), 400);
  await c.env.DB.prepare(
    `UPDATE cbt_exam_sessions SET status='submitted', finished_at=? WHERE id=?`
  ).bind(now(), sessionId).run();
  const result = await computeScore(c.env.DB, sessionId, session.exam_id, session.user_id, session.user_type);
  const exam = await c.env.DB.prepare(
    "SELECT completion_message, is_score_visible FROM cbt_exams WHERE id=?"
  ).bind(session.exam_id).first();
  return c.json(ok({
    completion_message: exam?.completion_message || "Ujian selesai.",
    score_visible: !!exam?.is_score_visible,
    ...exam?.is_score_visible ? result : {}
  }, "Ujian berhasil diselesaikan"));
});
async function computeScore(db, sessionId, examId, userId, userType) {
  const { results: answers } = await db.prepare(
    "SELECT question_id, selected_option_id FROM cbt_student_answers WHERE session_id=?"
  ).bind(sessionId).all();
  const { results: correctOpts } = await db.prepare(
    `SELECT qo.id as option_id, qo.question_id FROM cbt_question_options qo
     JOIN cbt_questions q ON q.id = qo.question_id WHERE q.exam_id=? AND qo.is_correct=1`
  ).bind(examId).all();
  const correctMap = new Map(correctOpts.map((o) => [o.question_id, o.option_id]));
  const totalQ = await db.prepare("SELECT COUNT(*) as cnt FROM cbt_questions WHERE exam_id=?").bind(examId).first();
  const total = totalQ?.cnt || 0;
  let correct = 0, wrong = 0;
  for (const a of answers) {
    if (a.selected_option_id === correctMap.get(a.question_id))
      correct++;
    else if (a.selected_option_id)
      wrong++;
  }
  const unanswered = total - correct - wrong;
  const score = total > 0 ? Math.round(correct / total * 1e4) / 100 : 0;
  await db.prepare(
    `INSERT OR REPLACE INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_questions, total_correct, total_wrong, total_unanswered, score)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(newId(), sessionId, examId, userId, userType, total, correct, wrong, unanswered, score).run();
  return { total_questions: total, total_correct: correct, total_wrong: wrong, total_unanswered: unanswered, score };
}
__name(computeScore, "computeScore");
var student_default = student;

// src/index.ts
var app = new Hono2();
app.use("*", async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.CORS_ORIGIN || "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400
  });
  return corsMiddleware(c, next);
});
app.use("*", logger());
app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
app.route("/api/auth", auth_default);
app.route("/api/admin", admin_default);
app.route("/api/proctor", proctor_default);
app.route("/api/student", student_default);
app.get("/r2/*", async (c) => {
  const key = c.req.path.replace("/r2/", "");
  const object = await c.env.R2.get(key);
  if (!object)
    return c.json({ error: "File tidak ditemukan" }, 404);
  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
});
app.notFound((c) => {
  return c.json({ success: false, error: "Endpoint tidak ditemukan" }, 404);
});
app.onError((e, c) => {
  console.error("Worker Error:", e.message, e.stack);
  return c.json({ success: false, error: "Terjadi kesalahan server" }, 500);
});
var src_default = app;
export {
  src_default as default
};
//# sourceMappingURL=index.js.map
