# Wetter mit Gedächtnis

Eine Wetter-App, die nicht nur zeigt, wie das Wetter gerade ist, sondern auch,
wie ungewöhnlich es im Vergleich zu den letzten Jahrzehnten ist.

**Live:** https://erdinc55.github.io/wetter/

## Zwei Ansichten

**Jetzt** zeigt das Übliche: aktuelle Temperatur, gefühlte Temperatur, Wind,
Niederschlag, Luftfeuchte, den Stundenverlauf für heute und sieben Tage
Vorhersage.

**Geschichte** ist der eigentliche Grund für das Projekt. Sie nimmt das heutige
Kalenderdatum und holt für den gewählten Ort jeden einzelnen Wert seit 1940.
Bei einem 15. September also jeden 15. September der letzten 85 Jahre.

Daraus entsteht ein Satz wie „Von 85 Jahren waren an diesem Datum 73 kälter als
heute" und eine Grafik aus zwei Hälften, die sich eine gemeinsame
Temperaturachse teilen: links jedes Jahr als einzelner Punkt über die Zeit,
rechts dieselben Werte zu einer Verteilung zusammengeschoben. Eine
durchgezogene Linie markiert den heutigen Wert und schneidet beide Hälften.

Links liest man den Trend ab, rechts, wie ungewöhnlich heute ist. Durch die
geteilte Achse ist sofort klar, dass es dieselben Daten sind.

Ich habe bewusst darauf verzichtet, die Zahlen zu kommentieren. Da steht, was
gemessen wurde, mehr nicht.

## Die Sache mit den Daten

Die App benutzt Open-Meteo. Kostenlos, keine Anmeldung, kein Schlüssel.

Zwei Dinge habe ich dabei erst beim Bauen gemerkt:

Das historische Archiv wird mit fünf bis sieben Tagen Verzug aktualisiert. Die
letzten Tage fehlen dort also einfach. Der naheliegende Ausweg hat einen Haken:
Die Vorhersage-Schnittstelle liefert zwar auch zurückliegende Tage, gibt dabei
aber die **damalige Vorhersage** zurück, nicht das tatsächlich gemessene
Wetter. Für das 30-Tage-Band führe ich deshalb beide Quellen nach Datum
zusammen, wobei das Archiv Vorrang hat.

Aus demselben Grund steht unten auf der Seite eine Fußnote: Der heutige Wert
kommt aus dem Vorhersagemodell, die historischen aus der Reanalyse. Das sind
unterschiedliche Quellen, und ich finde, das gehört dazugesagt.

Für die Jahrzehnte-Auswertung stelle ich eine einzige große Anfrage über den
kompletten Zeitraum und filtere die passenden Tage im Browser heraus. 85
Einzelanfragen wären 85-mal Verbindungsaufbau gewesen.

## Wettlaufende Anfragen

Tippt man schnell „Mün" und gleich darauf „München", sind zwei Suchanfragen
gleichzeitig unterwegs. Antworten kommen aber nicht zwingend in der Reihenfolge
zurück, in der sie losgeschickt wurden — die Antwort zu „Mün" kann nach der zu
„München" eintreffen und die richtige Vorschlagsliste wieder überschreiben.

Dagegen zwei Maßnahmen: Jede neue Eingabe bricht die vorherige Anfrage über
einen `AbortController` ab, und zusätzlich bekommt jede Anfrage eine laufende
Nummer. Passt die Nummer bei der Rückkehr nicht mehr zur neuesten, wird die
Antwort verworfen.

Das war mein erstes Projekt mit Daten aus dem Internet, und dieser Punkt hat
mich am meisten überrascht. Bei Daten aus dem eigenen Code stellt sich die
Frage nie.

## Farben

Kalt nach blau, heiß nach rot, über sieben Ankerfarben mit linearer
Interpolation dazwischen. Dadurch unterscheiden sich 12 und 14 Grad kaum,
während minus 5 und plus 35 klar auseinanderliegen.

Der neutrale Punkt liegt bei 15 Grad statt bei null — so bleibt mildes Wetter
unauffällig. Und die Skala färbt nur Daten, nie die Oberfläche. Sonst würde an
heißen Tagen die ganze Seite rot leuchten.

## Was drin steckt

Reines HTML, CSS und JavaScript, keine Bibliotheken. Die Grafiken sind
selbstgebautes SVG.

- `index.html` — Aufbau
- `style.css` — Gestaltung
- `script.js` — Datenabruf, Auswertung, Grafiken

## Selbst ausprobieren

```
git clone https://github.com/Erdinc55/wetter.git
```

`index.html` im Browser öffnen. Einstellungen wie Wartezeit beim Tippen oder
Anzahl der Vorhersagetage stehen oben in `script.js` im Block `KONFIG`.

## Was noch offen ist

- Die Geschichte-Ansicht braucht beim ersten Aufruf einen Moment, weil rund
  31.000 Tageswerte geladen werden
- Bei der Standortfreigabe zeige ich nur die Koordinaten an, keinen Ortsnamen —
  dafür bräuchte es eine umgekehrte Ortssuche

Daten: Open-Meteo, ERA5 (CC BY 4.0)
