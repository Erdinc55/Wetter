const API = {
  geo:     "https://geocoding-api.open-meteo.com/v1/search",
  wetter:  "https://api.open-meteo.com/v1/forecast",
  archiv:  "https://archive-api.open-meteo.com/v1/archive"
};

const KONFIG = {
  tippPauseMs: 280,
  archivStart: "1940-01-01",
  archivVerzugTage: 6,
  vorschauTage: 7,
  vergangeneTage: 12,
  bandTage: 30
};

const SPEICHER = "wetter-ort";

const ANKER = [
  { t: -15, c: [ 43,  58, 143] },
  { t:  -5, c: [ 74, 127, 193] },
  { t:   5, c: [143, 185, 204] },
  { t:  15, c: [214, 210, 196] },
  { t:  25, c: [221, 154,  91] },
  { t:  35, c: [193,  74,  50] },
  { t:  45, c: [143,  33,  24] }
];

function tempFarbe(t) {
  if (t == null || Number.isNaN(t)) return "#c9ccce";
  if (t <= ANKER[0].t) return rgb(ANKER[0].c);
  if (t >= ANKER[ANKER.length - 1].t) return rgb(ANKER[ANKER.length - 1].c);

  for (let i = 0; i < ANKER.length - 1; i++) {
    const a = ANKER[i], b = ANKER[i + 1];
    if (t >= a.t && t <= b.t) {
      const anteil = (t - a.t) / (b.t - a.t);
      return rgb([
        a.c[0] + (b.c[0] - a.c[0]) * anteil,
        a.c[1] + (b.c[1] - a.c[1]) * anteil,
        a.c[2] + (b.c[2] - a.c[2]) * anteil
      ]);
    }
  }
  return "#c9ccce";
}

function rgb(c) {
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
}

const LAGE = {
  0: "Klar", 1: "Überwiegend klar", 2: "Teils bewölkt", 3: "Bedeckt",
  45: "Nebel", 48: "Reifnebel",
  51: "Leichter Niesel", 53: "Niesel", 55: "Starker Niesel",
  56: "Gefrierender Niesel", 57: "Gefrierender Niesel",
  61: "Leichter Regen", 63: "Regen", 65: "Starker Regen",
  66: "Gefrierender Regen", 67: "Gefrierender Regen",
  71: "Leichter Schneefall", 73: "Schneefall", 75: "Starker Schneefall",
  77: "Schneegriesel",
  80: "Regenschauer", 81: "Regenschauer", 82: "Kräftige Schauer",
  85: "Schneeschauer", 86: "Schneeschauer",
  95: "Gewitter", 96: "Gewitter mit Hagel", 99: "Gewitter mit Hagel"
};

let ort = null;
let archivCache = {};
let letzteWetterDaten = null;

let suchAbbruch = null;
let ladeAbbruch = null;
let suchLauf = 0;
let tippTimer = null;
let markierterVorschlag = -1;

const elSuche      = document.getElementById("suche");
const elVorschlag  = document.getElementById("vorschlaege");
const elStandort   = document.getElementById("standort");
const elOrtsname   = document.getElementById("ortsname");
const elMeldung    = document.getElementById("meldung");

const tabJetzt     = document.getElementById("tab-jetzt");
const tabGesch     = document.getElementById("tab-geschichte");
const panelJetzt   = document.getElementById("panel-jetzt");
const panelGesch   = document.getElementById("panel-geschichte");

const elGrad       = document.getElementById("jetzt-grad");
const elLage       = document.getElementById("jetzt-lage");
const elStunden    = document.getElementById("stunden");
const elTage       = document.getElementById("tage");

const elEinordnung = document.getElementById("einordnung");
const elGrafik     = document.getElementById("grafik");
const elBand       = document.getElementById("band");
const elLegende    = document.getElementById("legende");

const SVGNS = "http://www.w3.org/2000/svg";

function svg(name, attribute = {}) {
  const el = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attribute)) el.setAttribute(k, v);
  return el;
}

function grad(wert, stellen = 0) {
  if (wert == null || Number.isNaN(wert)) return "–";
  return wert.toFixed(stellen).replace(".", ",") + " °C";
}

function datumISO(d) {
  return d.getFullYear() + "-" +
         String(d.getMonth() + 1).padStart(2, "0") + "-" +
         String(d.getDate()).padStart(2, "0");
}

function meldungZeigen(text, mitWiederholen = false) {
  elMeldung.innerHTML = "";
  elMeldung.append(document.createTextNode(text));
  if (mitWiederholen && ort) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Erneut versuchen";
    b.addEventListener("click", () => ortLaden(ort));
    elMeldung.appendChild(b);
  }
  elMeldung.hidden = false;
}

function meldungWeg() {
  elMeldung.hidden = true;
  elMeldung.textContent = "";
}

async function holen(basis, parameter, signal) {
  const url = new URL(basis);
  for (const [k, v] of Object.entries(parameter)) url.searchParams.set(k, v);

  const antwort = await fetch(url, { signal });
  if (!antwort.ok) throw new Error("HTTP " + antwort.status);
  return antwort.json();
}

async function orteSuchen(begriff) {
  if (suchAbbruch) suchAbbruch.abort();
  suchAbbruch = new AbortController();

  const meineNummer = ++suchLauf;

  try {
    const daten = await holen(API.geo, {
      name: begriff, count: 6, language: "de", format: "json"
    }, suchAbbruch.signal);

    if (meineNummer !== suchLauf) return;

    vorschlaegeZeigen(daten.results || []);
  } catch (fehler) {
    if (fehler.name === "AbortError") return;
    console.error("Ortssuche fehlgeschlagen:", fehler);
    vorschlaegeZeigen([]);
  }
}

function vorschlaegeZeigen(treffer) {
  elVorschlag.innerHTML = "";
  markierterVorschlag = -1;

  if (treffer.length === 0) {
    elVorschlag.hidden = true;
    elSuche.setAttribute("aria-expanded", "false");
    return;
  }

  treffer.forEach((t, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    li.id = "vorschlag-" + i;

    const name = document.createElement("span");
    name.textContent = t.name;

    const region = document.createElement("span");
    region.className = "region";
    region.textContent = " · " + [t.admin1, t.country].filter(Boolean).join(", ");

    li.append(name, region);
    li.addEventListener("click", () => vorschlagWaehlen(t));
    elVorschlag.appendChild(li);
  });

  elVorschlag.hidden = false;
  elSuche.setAttribute("aria-expanded", "true");
}

function vorschlagWaehlen(treffer) {
  const neu = {
    name: treffer.name,
    region: treffer.admin1 || "",
    land: treffer.country || "",
    lat: treffer.latitude,
    lon: treffer.longitude
  };
  elSuche.value = "";
  elVorschlag.hidden = true;
  elSuche.setAttribute("aria-expanded", "false");
  ortLaden(neu);
}

async function ortLaden(neuerOrt) {
  ort = neuerOrt;
  elOrtsname.textContent = [ort.name, ort.region, ort.land].filter(Boolean).join(", ");
  meldungWeg();
  ladezustandAn();

  try { localStorage.setItem(SPEICHER, JSON.stringify(ort)); } catch { /* egal */ }

  if (ladeAbbruch) ladeAbbruch.abort();
  ladeAbbruch = new AbortController();
  const signal = ladeAbbruch.signal;

  try {
    const wetter = await wetterHolen(signal);
    letzteWetterDaten = wetter;
    jetztZeichnen(wetter);
  } catch (fehler) {
    if (fehler.name === "AbortError") return;
    console.error("Wetterdaten fehlgeschlagen:", fehler);
    meldungZeigen("Die Wetterdaten konnten nicht geladen werden. Prüf deine Internetverbindung.", true);
    return;
  }

try {
    const archiv = await archivHolen(signal);
    geschichteZeichnen(archiv);
  } catch (fehler) {
    if (fehler.name === "AbortError") return;
    console.error("Archivdaten fehlgeschlagen:", fehler);
    elEinordnung.textContent = "Für diesen Ort ließ sich das Archiv nicht laden.";
    elGrafik.innerHTML = "";
    elBand.innerHTML = "";
    elLegende.textContent = "";
  }
}

async function wetterHolen(signal) {
  return holen(API.wetter, {
    latitude: ort.lat,
    longitude: ort.lon,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,weather_code",
    hourly: "temperature_2m",
    daily: "temperature_2m_max,temperature_2m_min,weather_code",
    timezone: "auto",
    forecast_days: KONFIG.vorschauTage,
    past_days: KONFIG.vergangeneTage
  }, signal);
}

async function archivHolen(signal) {
  const schluessel = ort.lat.toFixed(3) + "," + ort.lon.toFixed(3);
  if (archivCache[schluessel]) return archivCache[schluessel];

  const ende = new Date();
  ende.setDate(ende.getDate() - KONFIG.archivVerzugTage);

  const daten = await holen(API.archiv, {
    latitude: ort.lat,
    longitude: ort.lon,
    start_date: KONFIG.archivStart,
    end_date: datumISO(ende),
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    timeformat: "unixtime"
  }, signal);

  const ausgewertet = archivAuswerten(daten);
  archivCache[schluessel] = ausgewertet;
  return ausgewertet;
}

function archivAuswerten(daten) {
  const versatz = daten.utc_offset_seconds || 0;
  const zeiten = daten.daily.time;
  const maxWerte = daten.daily.temperature_2m_max;
  const minWerte = daten.daily.temperature_2m_min;

  const heute = new Date();
  const zielMonat = heute.getMonth();
  const zielTag = heute.getDate();

  const jahre = [];
  const tageReihe = [];

  for (let i = 0; i < zeiten.length; i++) {
    const max = maxWerte[i];
    if (max == null) continue;

    const d = new Date((zeiten[i] + versatz) * 1000);
    const monat = d.getUTCMonth();
    const tag = d.getUTCDate();

    if (monat === zielMonat && tag === zielTag) {
      jahre.push({ jahr: d.getUTCFullYear(), max });
    }

    tageReihe.push({
      datum: datumISO(new Date(Date.UTC(d.getUTCFullYear(), monat, tag))),
      max,
      min: minWerte ? minWerte[i] : null
    });
  }

  return { jahre, tageReihe };
}


function ladezustandAn() {
  elGrad.textContent = "–";
  elLage.textContent = "Lädt …";

  elStunden.innerHTML = "";
  for (let i = 0; i < 12; i++) {
    const d = document.createElement("div");
    d.className = "stunde";
    const b = document.createElement("div");
    b.className = "balken skelett";
    d.appendChild(b);
    elStunden.appendChild(d);
  }

  elTage.innerHTML = "";
  for (let i = 0; i < KONFIG.vorschauTage; i++) {
    const li = document.createElement("li");
    const s = document.createElement("div");
    s.className = "spanne skelett";
    s.style.gridColumn = "1 / -1";
    li.appendChild(s);
    elTage.appendChild(li);
  }

  elEinordnung.textContent = "Lädt …";
  elGrafik.innerHTML = "";
  elBand.innerHTML = "";
  elLegende.textContent = "";
}

function jetztZeichnen(daten) {
  const jetzt = daten.current;

  elGrad.textContent = grad(jetzt.temperature_2m, 1);
  elGrad.style.color = tempFarbe(jetzt.temperature_2m);
  elLage.textContent = LAGE[jetzt.weather_code] || "—";

  document.getElementById("w-gefuehlt").textContent = grad(jetzt.apparent_temperature, 1);
  document.getElementById("w-wind").textContent =
    jetzt.wind_speed_10m != null ? jetzt.wind_speed_10m.toFixed(0) + " km/h" : "–";
  document.getElementById("w-regen").textContent =
    jetzt.precipitation != null ? jetzt.precipitation.toFixed(1).replace(".", ",") + " mm" : "–";
  document.getElementById("w-feuchte").textContent =
    jetzt.relative_humidity_2m != null ? jetzt.relative_humidity_2m + " %" : "–";

  stundenZeichnen(daten);
  tageZeichnen(daten);
}

function stundenZeichnen(daten) {
  elStunden.innerHTML = "";

  const zeiten = daten.hourly.time;
  const temps = daten.hourly.temperature_2m;
  const heuteISO = jetztDatumISO(daten);

  const aktuelleStunde = Number(daten.current.time.slice(11, 13));

  const indizes = [];
  for (let i = 0; i < zeiten.length; i++) {
    if (zeiten[i].startsWith(heuteISO)) indizes.push(i);
  }

  indizes.forEach(i => {
    const stunde = Number(zeiten[i].slice(11, 13));
    const t = temps[i];

    const d = document.createElement("div");
    d.className = "stunde" + (stunde === aktuelleStunde ? " jetzt" : "");

    const uhr = document.createElement("div");
    uhr.className = "uhr";
    uhr.textContent = String(stunde).padStart(2, "0");

    const balken = document.createElement("div");
    balken.className = "balken";
    balken.style.background = tempFarbe(t);

    const temp = document.createElement("div");
    temp.className = "temp";
    temp.textContent = t != null ? Math.round(t) + "°" : "–";

    d.append(uhr, balken, temp);
    elStunden.appendChild(d);
  });
}

function jetztDatumISO(daten) {
  return daten.current.time.slice(0, 10);
}

function tageZeichnen(daten) {
  elTage.innerHTML = "";

  const zeiten = daten.daily.time;
  const maxW = daten.daily.temperature_2m_max;
  const minW = daten.daily.temperature_2m_min;
  const heuteISO = jetztDatumISO(daten);

  const start = zeiten.indexOf(heuteISO);
  const von = start >= 0 ? start : 0;
  const bis = Math.min(von + KONFIG.vorschauTage, zeiten.length);

  let skalaMin = Infinity, skalaMax = -Infinity;
  for (let i = von; i < bis; i++) {
    if (minW[i] != null) skalaMin = Math.min(skalaMin, minW[i]);
    if (maxW[i] != null) skalaMax = Math.max(skalaMax, maxW[i]);
  }
  const spanne = Math.max(1, skalaMax - skalaMin);

  const wochentage = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

  for (let i = von; i < bis; i++) {
    const d = new Date(zeiten[i] + "T12:00:00");
    const li = document.createElement("li");

    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = i === von
      ? "Heute"
      : wochentage[d.getDay()] + ", " + d.getDate() + "." + (d.getMonth() + 1) + ".";

    const min = document.createElement("span");
    min.className = "min";
    min.textContent = minW[i] != null ? Math.round(minW[i]) + "°" : "–";

    const spanneEl = document.createElement("span");
    spanneEl.className = "spanne";
    const balken = document.createElement("span");
    const links = ((minW[i] - skalaMin) / spanne) * 100;
    const breite = ((maxW[i] - minW[i]) / spanne) * 100;
    balken.style.left = links + "%";
    balken.style.width = Math.max(2, breite) + "%";
    balken.style.background =
      `linear-gradient(90deg, ${tempFarbe(minW[i])}, ${tempFarbe(maxW[i])})`;
    spanneEl.appendChild(balken);

    const max = document.createElement("span");
    max.className = "max";
    max.textContent = maxW[i] != null ? Math.round(maxW[i]) + "°" : "–";

    li.append(tag, min, spanneEl, max);
    elTage.appendChild(li);
  }
}

function geschichteZeichnen(archiv) {
  const jahre = archiv.jahre;

  if (jahre.length < 5) {
    elEinordnung.textContent = "Für diesen Ort liegen zu wenige historische Daten vor.";
    elGrafik.innerHTML = "";
    elBand.innerHTML = "";
    return;
  }

  const heuteMax = heutigerHoechstwert();

  if (heuteMax != null) {
    const kaelter = jahre.filter(j => j.max < heuteMax).length;
    const anteil = Math.round((kaelter / jahre.length) * 100);
    elEinordnung.innerHTML =
      `Von <b>${jahre.length} Jahren</b> waren an diesem Datum ` +
      `<b>${kaelter}</b> kälter als heute — das sind ${anteil} Prozent.`;
  } else {
    elEinordnung.textContent =
      `${jahre.length} Jahre mit Daten für dieses Kalenderdatum.`;
  }

  grafikZeichnen(jahre, heuteMax);
  bandZeichnen(archiv.tageReihe);

  elLegende.textContent =
    "Links jedes Jahr als einzelner Punkt, eingefärbt nach Temperatur. " +
    "Die durchgezogene Linie ist das gleitende Mittel über zehn Jahre. " +
    "Rechts dieselben Werte zu einer Verteilung zusammengeschoben. " +
    "Die gestrichelte Linie markiert den heutigen Wert.";
}

function heutigerHoechstwert() {
  if (!letzteWetterDaten) return null;
  const zeiten = letzteWetterDaten.daily.time;
  const heuteISO = jetztDatumISO(letzteWetterDaten);
  const i = zeiten.indexOf(heuteISO);
  return i >= 0 ? letzteWetterDaten.daily.temperature_2m_max[i] : null;
}

function grafikZeichnen(jahre, heuteMax) {
  elGrafik.innerHTML = "";

  const B = 760, H = 380;
  const rand = { oben: 18, unten: 34, links: 42, rechts: 12 };
  const verteilungBreite = 118;
  const luecke = 26;

  const streuRechts = B - rand.rechts - verteilungBreite - luecke;
  const streuLinks = rand.links;
  const streuBreite = streuRechts - streuLinks;
  const hoehe = H - rand.oben - rand.unten;

  const werte = jahre.map(j => j.max);
  if (heuteMax != null) werte.push(heuteMax);
  let yMin = Math.min(...werte), yMax = Math.max(...werte);
  const puffer = Math.max(1, (yMax - yMin) * 0.12);
  yMin -= puffer; yMax += puffer;

  const jahrMin = jahre[0].jahr;
  const jahrMax = jahre[jahre.length - 1].jahr;

  const yPos = t => rand.oben + hoehe - ((t - yMin) / (yMax - yMin)) * hoehe;
  const xPos = j => streuLinks + ((j - jahrMin) / Math.max(1, jahrMax - jahrMin)) * streuBreite;

  const schritt = achsenSchritt(yMax - yMin);
  for (let t = Math.ceil(yMin / schritt) * schritt; t <= yMax; t += schritt) {
    const y = yPos(t);
    elGrafik.appendChild(svg("line", {
      x1: streuLinks, y1: y, x2: B - rand.rechts, y2: y, class: "achse-linie"
    }));
    const beschriftung = svg("text", {
      x: streuLinks - 8, y: y + 3.5, class: "achse-text", "text-anchor": "end"
    });
    beschriftung.textContent = Math.round(t) + "°";
    elGrafik.appendChild(beschriftung);
  }

  const jahrSchritte = [];
  for (let j = Math.ceil(jahrMin / 20) * 20; j <= jahrMax; j += 20) jahrSchritte.push(j);
  if (jahrSchritte[jahrSchritte.length - 1] !== jahrMax) jahrSchritte.push(jahrMax);

  jahrSchritte.forEach(j => {
    const beschriftung = svg("text", {
      x: xPos(j), y: H - 14, class: "achse-text", "text-anchor": "middle"
    });
    beschriftung.textContent = j;
    elGrafik.appendChild(beschriftung);
  });

  jahre.forEach(j => {
    const kreis = svg("circle", {
      cx: xPos(j.jahr).toFixed(1),
      cy: yPos(j.max).toFixed(1),
      r: 3.1,
      fill: tempFarbe(j.max),
      class: "punkt"
    });
    const titel = svg("title");
    titel.textContent = `${j.jahr}: ${grad(j.max, 1)}`;
    kreis.appendChild(titel);
    elGrafik.appendChild(kreis);
  });

  const mittel = [];
  for (let i = 0; i < jahre.length; i++) {
    const von = Math.max(0, i - 5);
    const bis = Math.min(jahre.length, i + 6);
    let summe = 0;
    for (let k = von; k < bis; k++) summe += jahre[k].max;
    mittel.push({ jahr: jahre[i].jahr, wert: summe / (bis - von) });
  }

  const pfad = mittel
    .map((m, i) => (i === 0 ? "M " : "L ") + xPos(m.jahr).toFixed(1) + " " + yPos(m.wert).toFixed(1))
    .join(" ");
  elGrafik.appendChild(svg("path", { d: pfad, class: "mittel-linie" }));

  const xTrenner = streuRechts + luecke / 2;
  elGrafik.appendChild(svg("line", {
    x1: xTrenner, y1: rand.oben, x2: xTrenner, y2: rand.oben + hoehe, class: "trenner"
  }));

  const faecher = 14;
  const fachHoehe = hoehe / faecher;
  const zaehlung = new Array(faecher).fill(0);

  jahre.forEach(j => {
    let idx = Math.floor(((j.max - yMin) / (yMax - yMin)) * faecher);
    idx = Math.max(0, Math.min(faecher - 1, idx));
    zaehlung[idx]++;
  });

  const groesstesFach = Math.max(...zaehlung);
  const xVerteilung = B - rand.rechts - verteilungBreite;

  zaehlung.forEach((anzahl, i) => {
    if (anzahl === 0) return;
    const breite = (anzahl / groesstesFach) * verteilungBreite;
    const fachMitte = yMin + ((i + 0.5) / faecher) * (yMax - yMin);
    const y = rand.oben + hoehe - (i + 1) * fachHoehe;

    const balken = svg("rect", {
      x: xVerteilung, y: y + 0.8,
      width: breite.toFixed(1),
      height: Math.max(1, fachHoehe - 1.6).toFixed(1),
      fill: tempFarbe(fachMitte),
      opacity: 0.85
    });
    const titel = svg("title");
    titel.textContent = `${anzahl} ${anzahl === 1 ? "Jahr" : "Jahre"} um ${Math.round(fachMitte)} °C`;
    balken.appendChild(titel);
    elGrafik.appendChild(balken);
  });

  if (heuteMax != null) {
    const y = yPos(heuteMax);
    elGrafik.appendChild(svg("line", {
      x1: streuLinks, y1: y, x2: B - rand.rechts, y2: y, class: "heute-linie"
    }));
    const beschriftung = svg("text", {
      x: streuLinks + 4, y: y - 6, class: "heute-text"
    });
    beschriftung.textContent = "heute " + grad(heuteMax, 1);
    elGrafik.appendChild(beschriftung);
  }
}

function achsenSchritt(spanne) {
  if (spanne <= 8) return 2;
  if (spanne <= 20) return 5;
  if (spanne <= 45) return 10;
  return 20;
}

function bandZeichnen(archivReihe) {
  elBand.innerHTML = "";

  const nachDatum = new Map();
  archivReihe.forEach(t => nachDatum.set(t.datum, t));

  if (letzteWetterDaten) {
    const zeiten = letzteWetterDaten.daily.time;
    const maxW = letzteWetterDaten.daily.temperature_2m_max;
    const minW = letzteWetterDaten.daily.temperature_2m_min;
    const heuteISO = jetztDatumISO(letzteWetterDaten);

    zeiten.forEach((datum, i) => {
      if (datum > heuteISO) return;
      if (nachDatum.has(datum)) return;
      nachDatum.set(datum, { datum, max: maxW[i], min: minW[i] });
    });
  }

  const alle = [...nachDatum.values()]
    .filter(t => t.max != null)
    .sort((a, b) => a.datum.localeCompare(b.datum));

  const tage = alle.slice(-KONFIG.bandTage);
  if (tage.length === 0) return;

  const B = 760, H = 140;
  const rand = { oben: 12, unten: 26, links: 42, rechts: 12 };
  const hoehe = H - rand.oben - rand.unten;
  const breite = B - rand.links - rand.rechts;

  const werte = [];
  tage.forEach(t => {
    werte.push(t.max);
    if (t.min != null) werte.push(t.min);
  });
  let yMin = Math.min(...werte), yMax = Math.max(...werte);
  const puffer = Math.max(1, (yMax - yMin) * 0.1);
  yMin -= puffer; yMax += puffer;

  const yPos = t => rand.oben + hoehe - ((t - yMin) / (yMax - yMin)) * hoehe;
  const saeuleBreite = breite / tage.length;

  const schritt = achsenSchritt(yMax - yMin);
  for (let t = Math.ceil(yMin / schritt) * schritt; t <= yMax; t += schritt) {
    const y = yPos(t);
    elBand.appendChild(svg("line", {
      x1: rand.links, y1: y, x2: B - rand.rechts, y2: y, class: "achse-linie"
    }));
    const beschriftung = svg("text", {
      x: rand.links - 8, y: y + 3.5, class: "achse-text", "text-anchor": "end"
    });
    beschriftung.textContent = Math.round(t) + "°";
    elBand.appendChild(beschriftung);
  }

  tage.forEach((t, i) => {
    const x = rand.links + i * saeuleBreite;
    const oben = yPos(t.max);
    const unten = t.min != null ? yPos(t.min) : oben + 3;

    const balken = svg("rect", {
      x: (x + saeuleBreite * 0.15).toFixed(1),
      y: oben.toFixed(1),
      width: Math.max(1.5, saeuleBreite * 0.7).toFixed(1),
      height: Math.max(2, unten - oben).toFixed(1),
      rx: 1.5,
      fill: tempFarbe(t.max),
      opacity: 0.88
    });
    const titel = svg("title");
    const d = t.datum.slice(8) + "." + t.datum.slice(5, 7) + ".";
    titel.textContent = t.min != null
      ? `${d}  ${Math.round(t.min)}° bis ${Math.round(t.max)}°`
      : `${d}  ${Math.round(t.max)}°`;
    balken.appendChild(titel);
    elBand.appendChild(balken);

    if (i % 5 === 0) {
      const beschriftung = svg("text", {
        x: (x + saeuleBreite / 2).toFixed(1),
        y: H - 9,
        class: "achse-text",
        "text-anchor": "middle"
      });
      beschriftung.textContent = t.datum.slice(8) + "." + t.datum.slice(5, 7) + ".";
      elBand.appendChild(beschriftung);
    }
  });
}

function reiterWechseln(zuJetzt) {
  tabJetzt.setAttribute("aria-selected", String(zuJetzt));
  tabGesch.setAttribute("aria-selected", String(!zuJetzt));
  tabJetzt.tabIndex = zuJetzt ? 0 : -1;
  tabGesch.tabIndex = zuJetzt ? -1 : 0;
  panelJetzt.hidden = !zuJetzt;
  panelGesch.hidden = zuJetzt;
}

tabJetzt.addEventListener("click", () => reiterWechseln(true));
tabGesch.addEventListener("click", () => reiterWechseln(false));

[tabJetzt, tabGesch].forEach(tab => {
  tab.addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const zuJetzt = tab === tabGesch;
    reiterWechseln(zuJetzt);
    (zuJetzt ? tabJetzt : tabGesch).focus();
  });
});

elSuche.addEventListener("input", () => {
  const begriff = elSuche.value.trim();
  clearTimeout(tippTimer);

  if (begriff.length < 2) {
    vorschlaegeZeigen([]);
    return;
  }
  tippTimer = setTimeout(() => orteSuchen(begriff), KONFIG.tippPauseMs);
});

elSuche.addEventListener("keydown", e => {
  const eintraege = [...elVorschlag.querySelectorAll("li")];
  if (eintraege.length === 0) return;

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const richtung = e.key === "ArrowDown" ? 1 : -1;
    markierterVorschlag =
      (markierterVorschlag + richtung + eintraege.length) % eintraege.length;
    eintraege.forEach((li, i) =>
      li.setAttribute("aria-selected", String(i === markierterVorschlag)));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const ziel = markierterVorschlag >= 0 ? markierterVorschlag : 0;
    eintraege[ziel].click();
  } else if (e.key === "Escape") {
    vorschlaegeZeigen([]);
  }
});

document.addEventListener("click", e => {
  if (!e.target.closest(".suchfeld-huelle")) vorschlaegeZeigen([]);
});


elStandort.addEventListener("click", () => {
  if (!navigator.geolocation) {
    meldungZeigen("Dein Browser gibt den Standort nicht preis. Nutz die Suche.");
    return;
  }

  meldungZeigen("Standort wird abgefragt …");

  navigator.geolocation.getCurrentPosition(
    position => {
      meldungWeg();
      ortLaden({
        name: "Aktueller Standort",
        region: position.coords.latitude.toFixed(2) + ", " + position.coords.longitude.toFixed(2),
        land: "",
        lat: position.coords.latitude,
        lon: position.coords.longitude
      });
    },
    fehler => {
      console.warn("Standort nicht verfügbar:", fehler);
      meldungZeigen("Der Standort wurde nicht freigegeben. Du kannst den Ort oben eintippen.");
    },
    { timeout: 10000 }
  );
});


(function start() {
  let gespeichert = null;
  try {
    const roh = localStorage.getItem(SPEICHER);
    if (roh) gespeichert = JSON.parse(roh);
  } catch { /* egal */ }

  if (gespeichert && gespeichert.lat != null) {
    ortLaden(gespeichert);
  } else {
    elOrtsname.textContent = "Such oben einen Ort oder gib deinen Standort frei.";
  }
})();
