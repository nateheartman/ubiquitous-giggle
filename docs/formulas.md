# Formulas

A formula property works out a value from the other properties of a row. ThoughtNotes formulas follow Notion's Formulas 2.0 closely, so most formulas copied from Notion guides work as they are. Everything that worked in earlier versions still works and still gives the same result.

```
{Price} * {Quantity}
if({Status} == "Done", "✓", daysUntil({Due}) + " days left")
prop("Items").map(current.prop("Price")).sum()
```

## Writing a formula

**Properties.** Write a property's name in braces, `{Due date}`, or as `prop("Due date")`. A one-word name works on its own: `Price * 2`. Names are not case sensitive. Renaming a property updates the formulas that use it.

**Values.** Numbers (`3`, `2.5`, `1e3`), text in quotes (`"hi"`, `'hi'`; `\n` is a new line, and a backslash before anything else makes it plain, so write `\\d` for a regular expression's `\d`), `true` and `false`, dates (`date("2026-10-14")`), and lists in brackets: `[1, 2, 3]`.

**Operators.** `+ - * / % ^`, comparisons `== != < > <= >=` (a single `=` also works), `and or not` (also `&& || !`), and `condition ? a : b`. `+` joins text, and `&` is the same as `+`. Blank values count as 0 in arithmetic, and if everything in a sum is blank the result is blank.

**Methods.** `x.f(a, b)` is the same as `f(x, a, b)`, for every function, and they chain:

```
prop("Tags").unique().sort().join(" · ")
{Due}.dateSubtract(1, "weeks").formatDate("MMM D")
```

**Variables.** `let(name, value, formula)` gives a value a name to use in the formula; `lets(a, 1, b, a + 1, a + b)` makes several, each able to use the ones before it. A name is one word, and hides a property of the same name inside the `let`.

```
let(total, {Price} * {Quantity}, total + total * 0.2)
```

**Working through a list.** `map`, `filter`, `find`, `findIndex`, `some`, `every` and `sort` take a list and a formula that is worked out for each item. Inside that formula `current` is the item and `index` its position, counting from 0. To use an outer `current` inside an inner callback, keep it with `let`.

```
{Scores}.filter(current >= 50).length()
{Words}.map(current + index)
[3, 1, 2].sort(-current)
```

## Relations

A relation property gives a list of the rows it links to. They show as their titles, and everything that used to work on titles (`join`, `contains`, `length`, comparing with text, sorting) still does. `row.prop("X")` reads a property X of a related row, including its formulas, rollups and other relations:

```
prop("Items").map(current.prop("Price")).sum()
prop("Tasks").filter(current.prop("Done")).length()
prop("Tasks").sort(current.prop("Due")).first().prop("Name")
```

Inside `current.prop("X")`, X is a property of the **related** database. Renaming a property of this database does not change it.

Limits: formulas that read each other's results through related rows can go three rows deep. A fourth, or a formula that ends up reading itself, shows an error instead of a result.

## Errors

A problem in a formula shows an error saying what is wrong and, in the formula editor, where. A regular expression that does not parse says so, and names the function.

## Differences from Notion

- `day()` is the day of the month and `weekday()` is the day of the week (1 Monday to 7 Sunday). In Notion `day()` is the weekday. Existing formulas depend on this, so `day()` stays as it was.
- `date(x)` reads a date from text (or gives back a date). Notion's `date()` is the day of the month; use `day()`.
- `replace(text, find, with)` replaces every occurrence of plain text and does not read a pattern. Use `replaceAll(text, pattern, with)` for regular expressions.
- `concat` joins lists into a list when it is given two or more lists, and joins everything else as text.
- `average` and `mean` are the same. `format` and `toText` are the same.
- `style()` and `unstyle()` are not available (formulas have no styled output yet).
- `link()` shows its label, and opens the address when clicked.

## Function reference

Dates and times are written as English patterns (`"MMM D, YYYY"`) and units (`"days"`, `"weeks"`, `"months"`, `"years"`, `"hours"`, `"minutes"`) in every interface language. In `formatDate`, `YYYY YY MMMM MMM MM M dddd ddd DD D HH H hh h mm A a` are replaced by the parts of the date, and text in `[brackets]` is left as it is.

### Logic

| Function | Takes | What it does | Example | Gives |
|---|---|---|---|---|
| `if()` | a condition, a value if true, a value if false | Picks one of two values | `if({Done}, "Done", "Open")` | "Done" or "Open" |
| `ifs()` | conditions and values, then a fallback | The value after the first true condition | `ifs({Score} >= 90, "A", {Score} >= 80, "B", "C")` | "A", "B" or "C" |
| `and()` | conditions | True when every condition is true | `and({Done}, {Score} > 50)` | true or false |
| `or()` | conditions | True when any condition is true | `or({Done}, {Late})` | true or false |
| `not()` | a condition | True when the condition is false | `not({Done})` | true or false |
| `empty()` | a value | True when the value is empty | `empty({Due})` | true when Due is blank |
| `ifEmpty()` | a value, a fallback | The value, or the fallback when it’s empty | `ifEmpty({Nickname}, {Name})` | Nickname, or Name when it is blank |
| `let()` | a name, its value, then the formula that uses it | Gives a value a name to use in the rest of the formula | `let(total, {Price} * {Quantity}, total + total * 0.2)` | the total plus 20% |
| `lets()` | names and values, then the formula that uses them | Gives several values names, each able to use the ones before it | `lets(a, 2, b, a * 3, a + b)` | 8 |

### Math

| Function | Takes | What it does | Example | Gives |
|---|---|---|---|---|
| `round()` | a number, decimal places | Rounds | `round(3.14159, 2)` | 3.14 |
| `floor()` | a number | Rounds down | `floor(2.7)` | 2 |
| `ceil()` | a number | Rounds up | `ceil(2.1)` | 3 |
| `abs()` | a number | The number without its sign | `abs(-4)` | 4 |
| `sqrt()` | a number | Square root | `sqrt(16)` | 4 |
| `pow()` | a number, a power | A number to a power | `pow(2, 10)` | 1024 |
| `mod()` | a number, a divisor | The remainder | `mod(10, 3)` | 1 |
| `min()` | numbers or lists | The smallest | `min(3, 1, 2)` | 1 |
| `max()` | numbers or lists | The largest | `max({Nums})` | the largest of the list |
| `sum()` | numbers or lists | Adds them up | `sum({Q1}, {Q2}, {Q3})` | the three added up |
| `average()` | numbers or lists | The mean of the numbers given | `average(1, 2, 3, 4)` | 2.5 |
| `mean()` | numbers or lists | The mean of the numbers given | `mean({Scores})` | the mean of the list |
| `median()` | numbers or lists | The middle one of the numbers given | `median(1, 5, 3)` | 3 |
| `cbrt()` | a number | Cube root | `cbrt(27)` | 3 |
| `exp()` | a number | e raised to a power | `exp(1)` | 2.71828182846 |
| `ln()` | a number | Natural logarithm | `ln(e())` | 1 |
| `log10()` | a number | Logarithm to base 10 | `log10(1000)` | 3 |
| `log2()` | a number | Logarithm to base 2 | `log2(8)` | 3 |
| `sign()` | a number | 1 for a positive number, -1 for a negative one, 0 for zero | `sign(-4)` | -1 |
| `pi()` | nothing | The number pi, 3.14159… | `pi()` | 3.14159265359 |
| `e()` | nothing | Euler’s number, 2.71828… | `e()` | 2.71828182846 |
| `toNumber()` | text | Text as a number | `toNumber("$1,234.50")` | 1234.5 |

### Text

| Function | Takes | What it does | Example | Gives |
|---|---|---|---|---|
| `concat()` | texts | Joins texts end to end, or lists into one list | `concat("a", "b", 1)` | "ab1"; concat([1, 2], [3]) is [1, 2, 3] |
| `length()` | text or a list | How many characters (or items) | `length("hello")` | 5; the number of items for a list |
| `lower()` | text | In lowercase | `lower("AbC")` | "abc" |
| `upper()` | text | In uppercase | `upper("AbC")` | "ABC" |
| `trim()` | text | Without spaces at either end | `trim("  hi  ")` | "hi" |
| `contains()` | text or a list, what to find | Whether it’s in there | `contains({Tags}, "exam")` | true when a tag is "exam" (case does not matter) |
| `startsWith()` | text, a start | Whether the text starts that way | `startsWith("Hello", "he")` | true |
| `endsWith()` | text, an end | Whether the text ends that way | `endsWith("Hello", "LO")` | true |
| `replace()` | text, what to find, what to put instead | Replaces every match of a piece of text | `replace("a-b-c", "-", "+")` | "a+b+c" (plain text, every match; for patterns use replaceAll) |
| `slice()` | text, start, end | Part of the text | `slice("Thought", 0, 3)` | "Tho" |
| `split()` | text, a separator | Text as a list | `split("a, b, c", ", ")` | ["a", "b", "c"] |
| `substring()` | text, start, end | The part of a text between two positions | `substring("Thought", 1, 4)` | "hou" |
| `padStart()` | text, a length, what to pad with | Adds characters at the start until the text is long enough | `padStart("7", 3, "0")` | "007" |
| `padEnd()` | text, a length, what to pad with | Adds characters at the end until the text is long enough | `padEnd("7", 3, "0")` | "700" |
| `link()` | a label, a web address | Text that links to a web address | `link("Docs", "https://example.com")` | the text "Docs", clickable when the address starts with http(s): or mailto: |
| `test()` | text, a pattern | Whether the text matches a pattern (a regular expression) | `test({Name}, "^Th")` | true when Name starts with "Th" |
| `match()` | text, a pattern | Every part of the text that matches a pattern (a regular expression) | `match("a1b22", "\\d+")` | ["1", "22"] (with groups in the pattern, the groups instead) |
| `replaceAll()` | text, a pattern, what to put instead | Replaces every match of a pattern (a regular expression) | `replaceAll("a1b22", "\\d", "#")` | "a#b##" |
| `toText()` | a value | Any value as text | `toText({Price}) + " dollars"` | "10 dollars" |
| `format()` | a value | Any value as text | `format({Price})` | 10 as text |
| `repeat()` | text, times | Repeats a text | `repeat("★", {Rating})` | "★★★" for a 3 |

### Dates

| Function | Takes | What it does | Example | Gives |
|---|---|---|---|---|
| `now()` | nothing | The current date and time | `now()` | the current date and time |
| `today()` | nothing | Today’s date | `today()` | today, without a time |
| `date()` | text | Text as a date | `date("2026-10-14")` | the date (a date or time written as text, "2026-10-14T09:30" too) |
| `dateAdd()` | a date, an amount, a unit | Adds an amount of time to a date | `dateAdd({Due}, 2, "weeks")` | the date two weeks later |
| `dateSubtract()` | a date, an amount, a unit | Subtracts an amount of time from a date | `dateSubtract({Due}, 3, "days")` | the date three days earlier |
| `dateBetween()` | a date, another date, a unit | How long from the second to the first | `dateBetween({End}, {Start}, "days")` | the days from Start to End |
| `daysUntil()` | a date | Days from today until the date (negative once it’s past) | `daysUntil({Due})` | days from today to Due (negative once past) |
| `formatDate()` | a date, a pattern | A date as text, by a pattern | `formatDate({Due}, "dddd, MMM D")` | "Wednesday, Oct 14" |
| `dateStart()` | a date | The start of a date range | `dateStart({Span})` | the first day of a date range |
| `dateEnd()` | a date | The end of a date range (the date itself when it has none) | `dateEnd({Span})` | the last day of a range (the date itself when it has no end) |
| `dateRange()` | a start date, an end date | A date range from one date to another | `dateRange({Start}, {Due})` | a range from Start to Due |
| `parseDate()` | text | Reads a date from text | `parseDate("2026-10-14")` | the date |
| `timestamp()` | a date | A date as milliseconds since 1970 | `timestamp({Due})` | milliseconds since 1 January 1970 |
| `fromTimestamp()` | a number | A date from milliseconds since 1970 | `fromTimestamp(1760400000000)` | the date and time |
| `week()` | a date | The week of the year (1 to 53) | `week({Due})` | the ISO week of the year, 1 to 53 |
| `year()` | a date | The year | `year({Due})` | 2026 |
| `month()` | a date | The month, 1 to 12 | `month({Due})` | 10 (1 to 12) |
| `day()` | a date | The day of the month | `day({Due})` | 14, the day of the month |
| `weekday()` | a date | The day of the week, 1 (Monday) to 7 (Sunday) | `weekday({Due})` | 3 (1 is Monday, 7 is Sunday) |
| `hour()` | a date | The hour, 0 to 23 | `hour({Meeting})` | 15 |
| `minute()` | a date | The minute, 0 to 59 | `minute({Meeting})` | 30 |

### Lists

| Function | Takes | What it does | Example | Gives |
|---|---|---|---|---|
| `count()` | a list | How many items | `count({Tags})` | how many items are not blank |
| `first()` | a list | The first item | `first({Tags})` | the first item |
| `last()` | a list | The last item | `last({Tags})` | the last item |
| `at()` | a list, a position | The item at a position, from 0 | `at({Tags}, 1)` | the second item (positions start at 0) |
| `join()` | a list, a separator | The items as text | `join({Tags}, " · ")` | the items as one text |
| `unique()` | a list | Without repeats | `unique({Tags})` | the list without repeats |
| `sort()` | a list, and optionally what to sort by | In order, or by what a formula gives for each item | `sort({Words})` | in order; sort(prop("Tasks"), current.prop("Due")) sorts by what the second value gives for each item |
| `reverse()` | a list | The list backwards | `reverse([1, 2, 3])` | [3, 2, 1] |
| `flat()` | a list | A list of lists as one list | `flat([[1, 2], [3]])` | [1, 2, 3] (one level) |
| `includes()` | a list, a value | Whether a list has the value | `includes({Tags}, "Exam")` | true or false |
| `map()` | a list, what to work out for each item | A new list | `prop("Items").map(current.prop("Price"))` | the list of prices |
| `filter()` | a list, a condition for each item | The items for which the condition is true, using current and index | `prop("Tasks").filter(current.prop("Done"))` | only the done tasks |
| `find()` | a list, a condition for each item | The first item for which the condition is true | `find({Nums}, current > 1)` | the first item above 1 (blank if none) |
| `findIndex()` | a list, a condition for each item | The position of the first item for which the condition is true (-1 if none) | `findIndex({Nums}, current > 1)` | its position, from 0 (-1 if none) |
| `some()` | a list, a condition for each item | Whether the condition is true for any item | `some({Nums}, current > 2)` | true when any item is above 2 |
| `every()` | a list, a condition for each item | Whether the condition is true for every item | `every({Nums}, current > 0)` | true when all are above 0 |

### Rows (relations)

| Function | Takes | What it does | Example | Gives |
|---|---|---|---|---|
| `prop()` | a row, a property name | A property of a row that a relation links to | `prop("Tasks").first().prop("Due")` | the Due date of the first related task |
| `id()` | nothing | This row’s id | `id()` | the row's id |
