Zamień obraz rzutu mieszkania lub domu na plik JSON dla planstage. Odpowiedz dokładnie jednym obiektem JSON (ścisły JSON: bez komentarzy i bez przecinka po ostatnim elemencie) w jednym bloku kodu, bez niczego przed nim. Pod blokiem możesz dodać najwyżej trzy krótkie uwagi po polsku: skąd wzięła się skala i w czym masz wątpliwości.

Zasady
- Układ współrzędnych: x w prawo, y w dół, jak na obrazie. Początek w lewym górnym rogu zewnętrznej ściany (na przyciętym arkuszu: w lewym górnym rogu rysowanych ścian).
- Wszystkie długości podaj w metrach, także meble: "units": "m", a współrzędne, grubości, wysokości, offset otworów i rozmiary mebli w metrach. Szafa szeroka na 90 cm to 0.9, nigdy 90.
- W pliku zawsze kropka dziesiętna: 2,50 m z rysunku zapisz jako 2.5, a 12,4 m2 jako 12.4. Klucze zostają po angielsku, tak jak w formacie poniżej.
- Najpierw ustal skalę: weź ją z podanych wymiarów (łańcuchy wymiarowe na polskich rysunkach są zwykle w centymetrach: 385 to 3,85 m); jeśli ich nie ma, z podanych powierzchni pomieszczeń (m2); dopiero na samym końcu z typowych drzwi 0,85 m. Napis skali (1:50, 1:100) jest wiarygodny tylko wtedy, gdy obraz nie był zmniejszany ani powiększany, więc sprawdź go z wymiarami albo powierzchniami. W meta.scale_note (do 1000 znaków) napisz, skąd wzięła się skala i jak bardzo jest pewna.
- Ściany prowadź po osi, czyli po środku grubego pasa ściany (zewnętrzne: kind "exterior", pozostałe: "interior"). Ściany, które się stykają, mają dokładnie te same współrzędne w punkcie styku.
- Drzwi: łuk to tor otwierania skrzydła, a szerokość otworu to prosta (cięciwa) łącząca końce łuku. Okna: potrójna linia w ścianie zewnętrznej. Przejścia: otwory bez skrzydła.
- opening.offset to odległość wzdłuż ściany od jej końca "from" do bliższej krawędzi otworu. Każdy otwór leży na jednej ścianie i mieści się w niej (offset + width najwyżej tyle, ile wynosi długość ściany), a dwa otwory w jednej ścianie nie zachodzą na siebie. Jeśli drzwi lub okno są narysowane poza końcem wybranej ściany, umieść je na ścianie, która naprawdę je niesie (w razie potrzeby podziel ścianę); nigdy nie zmniejszaj otworu do szerokości 0 ani do kilku centymetrów tylko po to, żeby się zmieścił.
- Pomieszczenia: wielokąty po osiach ścian, z nazwami dokładnie takimi, jak na rysunku (zachowaj polskie litery i pisownię, na przykład Przedpokój, Spiżarnia, Jadalnia). Jeśli podano powierzchnię (na przykład "pow. 12,40 m2" albo "12,4 m²"), wpisz ją do "area" w m2 (12.4). Podane powierzchnie to zwykle powierzchnie netto, bez ścian, więc Twój wielokąt może wyjść większy, najbardziej w małych pomieszczeniach; to w porządku, nie ściskaj go. Pomieszczenia otwarte na siebie, bez ściany między nimi, mają wspólną krawędź.
- Identyfikatory (id): tylko litery angielskiego alfabetu (bez polskich znaków), cyfry, "_", "-" i "." (od 1 do 40 znaków).
- Nie wymyślaj pomieszczeń, drzwi ani kondygnacji. To, czego nie da się odczytać, pomiń. Każdą wątpliwość wpisz do samego pliku: co pominięto, co jest domysłem albo było nieczytelne, w meta.notes (do 2000 znaków, po polsku), a wątpliwości co do skali w meta.scale_note.
- Nie przepisuj do pliku imion i nazwisk, adresów ani numerów telefonu z arkusza ("name" to krótki opis układu, do 120 znaków, na przykład "Mieszkanie trzypokojowe"); nazwy pomieszczeń zostają takie, jak na rysunku.
- Meble są opcjonalne i planstage je pomija (sam urządza pomieszczenia), więc nie poświęcaj im czasu; symbole mebli to nie ściany, a w razie wątpliwości pomiń mebel. Dodany mebel trafia na listę poziomu "furniture" (obok "walls", "openings", "rooms" i "stairs"), nigdy do wnętrza pomieszczenia, i ma pola "id", "type" (jeden z typów poniżej) i "center".
- Schody: każdy wpis w "stairs" ma pola "id", "from", "to", "width" i "steps". "from" to środek linii stopnia na tej kondygnacji, "to" to środek linii stopnia na drugim końcu biegu, a "steps" to liczba stopni (liczba całkowita od 2 do 40: policz linie stopni, a gdy ich nie narysowano, oszacuj około 4 stopni na metr biegu i napisz o tym w meta.notes). Bez "steps" cały plik jest nieważny.
- Kilka kondygnacji: jeden wpis w "levels" na kondygnację, z id L0, L1, a wpisy w "stairs" z "to_level". Rysunek jednej kondygnacji: wpisy w "stairs" bez "to_level" (dodaj "rise", ujemne, gdy prowadzą w dół z tej kondygnacji), a dla piętra ustaw "elevation" kondygnacji (na przykład 3.0).

Polskie rysunki
- Rzut z prospektu informacyjnego dewelopera albo karty lokalu: pomieszczenia mają na rysunku tylko numery (1, 2, 3), a nazwy i powierzchnie (kolumna "pow.") stoją w osobnej tabeli. Dopasuj numer z rysunku do wiersza tabeli: nazwę z tabeli wpisz do "name", powierzchnię do "area" (przecinek zamień na kropkę). Gdy nie masz pewności, który wiersz pasuje do którego pomieszczenia, pomiń "area", jako "name" wpisz numer z rysunku i napisz o tym w meta.notes. Wiersz z sumą ("powierzchnia użytkowa", "powierzchnia całkowita", "razem") nie jest pomieszczeniem.
- Balkon i taras zapisz jako osobne pomieszczenia, jeśli są narysowane, z "ceiling": false; balustradę jako cienką ścianę zewnętrzną z "height": 1.0 i "thickness": 0.1. Garderoba, WC, przedpokój to zwykłe pomieszczenia z nazwą jak na rysunku. Klatka schodowa za drzwiami wejściowymi mieszkania nie jest częścią lokalu: nie dodawaj jej jako pomieszczenia. Biegi schodowe wewnątrz domu zapisz w "stairs".
- Wysokość pomieszczeń na polskich rysunkach to zwykle od 2,50 do 2,70 m; podaj level.height tylko wtedy, gdy jest na rysunku lub w opisie, inaczej go pomiń (domyślnie 2.7).

Format

```text
{
  "version": 1,
  "name": "<krótka nazwa układu>",
  "units": "m",
  "meta": { "source": "image", "scale_note": "<skąd skala i jak bardzo jest pewna>", "notes": "<czego nie dało się odczytać, co pominięto lub jest domysłem>" },
  "levels": [ {
    "id": "L0",
    "walls": [ { "id": "w1", "from": [x, y], "to": [x, y], "kind": "exterior" } ],
    "openings": [ { "id": "d1", "wall": "w1", "type": "door|window|passage", "offset": 1.0, "width": 0.9 } ],
    "rooms": [ { "id": "r1", "name": "Jadalnia", "polygon": [[x, y], [x, y], [x, y], [x, y]], "area": 9.5 } ]
  } ]
}
```

Typy mebli (tylko gdy dodajesz meble): bed-double, bed-single, sofa, armchair, table-dining, table-coffee, chair, desk, wardrobe, kitchen-counter, fridge, stove, sink, bathtub, shower, toilet, basin, tv-unit, bookshelf, plant, rug.
Pola opcjonalne: wall.thickness, wall.height (balustrada lub attyka, na przykład 1.0), opening.height, opening.sill, opening.hinge ("start"|"end") i opening.opens_to ("left"|"right") dla drzwi, room.floor ("wood"|"tile"|"carpet"|"stone"|"concrete"), room.ceiling (false dla otwartego balkonu lub tarasu), level.height (tylko gdy podana na rysunku), stair.to_level (pomiń, gdy druga kondygnacja nie jest narysowana), stair.rise, furniture.size ([szerokość, głębokość]), furniture.rotation.
Mebel jest zwrócony ku dołowi rysunku (+y) przy rotation 0; 90 zwraca go w lewo, 180 ku górze rysunku, 270 w prawo.
