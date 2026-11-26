import { test } from "node:test";
import assert from "node:assert/strict";
import { addressKey, sameHouseAddress, takeApart } from "./address-match.ts";

/**
 * Pairs of addresses, the first as a listing or a person writes it, the
 * second as a property record does. The first table is one house written two
 * ways; the second is two houses. A check that only guards against the
 * second kind turns the right house away (it did: fifteen of seventeen
 * ordinary Washington addresses in a review), and one that only welcomes the
 * first kind takes the house next door.
 *
 * The addresses are made up to have the shapes Washington's do: streets
 * named for a compass point ("E North St"), lettered streets ("E St"),
 * "Street Ct" and "Avenue Ct", townhouses with a letter, half numbers.
 */
const SAME: [asked: string, onRecord: string][] = [
  // Written the same.
  ["13013 224th St E, Graham, WA 98338", "13013 224th St E, Graham, WA 98338"],
  ["8208 243rd Street Ct E, Graham, WA 98338", "8208 243rd Street Ct E, Graham, WA 98338"],
  ["23705 77th Avenue Ct E, Graham, WA 98338", "23705 77th Avenue Ct E, Graham, WA 98338"],
  // Punctuation, capitals, the zip's four extra digits, a country, no commas.
  ["13013 224TH ST E, GRAHAM, WA 98338-4410", "13013 224th St E, Graham, WA 98338"],
  ["13013 224th St. E., Graham, WA 98338, USA", "13013 224th St E, Graham, WA 98338"],
  ["13013 224th St E Graham WA 98338", "13013 224th St E, Graham, WA 98338"],
  ["13013  224th St E,Graham,WA 98338", "13013 224th St E, Graham, WA 98338"],
  // Words written out or shortened.
  ["13013 224th Street East, Graham, WA 98338", "13013 224th St E, Graham, WA 98338"],
  ["8208 243rd St Ct E, Graham, WA 98338", "8208 243rd Street Ct E, Graham, WA 98338"],
  ["4821 Orchard Loop Road, Fixture Falls, WA 98000", "4821 Orchard Loop Rd, Fixture Falls, WA 98000"],
  ["123 North Main Street, Kent, WA 98032", "123 N Main St, Kent, WA 98032"],
  ["500 Fourth Ave, Seattle, WA 98104", "500 4th Ave, Seattle, WA 98104"],
  ["100 Mount Baker Hwy, Bellingham, WA 98226", "100 Mt Baker Hwy, Bellingham, WA 98226"],
  ["200 Saint Helens Ave, Tacoma, WA 98402", "200 St Helens Ave, Tacoma, WA 98402"],
  ["300 Point Fosdick Dr NW, Gig Harbor, WA 98335", "300 Pt Fosdick Dr NW, Gig Harbor, WA 98335"],
  ["1234 Avenue D, Snohomish, WA 98290", "1234 Ave D, Snohomish, WA 98290"],
  ["9116 State Route 9, Lake Stevens, WA 98258", "9116 SR 9, Lake Stevens, WA 98258"],
  ["9116 Highway 9, Lake Stevens, WA 98258", "9116 State Route 9, Lake Stevens, WA 98258"],
  ["9116 Hwy 9 NE, Lake Stevens, WA 98258", "9116 State Route 9 NE, Lake Stevens, WA 98258"],
  // Streets named for a compass point, with a compass point in front; lettered streets.
  ["2415 E North St, Seattle, WA 98112", "2415 E North St, Seattle, WA 98112"],
  ["12345 NE North Shore Rd, Belfair, WA 98528", "12345 NE North Shore Rd, Belfair, WA 98528"],
  ["23456 NW West Kingston Rd, Kingston, WA 98346", "23456 NW West Kingston Rd, Kingston, WA 98346"],
  ["18021 E South Riverton Ave, Spokane Valley, WA 99016", "18021 E South Riverton Ave, Spokane Valley, WA 99016"],
  ["2415 East North St, Seattle, WA 98112", "2415 E North St, Seattle, WA 98112"],
  ["715 East E St, Tacoma, WA 98421", "715 E E St, Tacoma, WA 98421"],
  ["1215 E St, Bellingham, WA 98225", "1215 E St, Bellingham, WA 98225"],
  ["1215 E Street, Bellingham, WA 98225", "1215 E St, Bellingham, WA 98225"],
  // Half numbers, hyphens, accents, apostrophes.
  ["123 1/2 S 56th St, Tacoma, WA 98408", "123 1/2 S 56th St, Tacoma, WA 98408"],
  ["12 O’Brien Ave S, Kent, WA 98032", "12 O'Brien Ave S, Kent, WA 98032"],
  ["12 O'Brien Ave S, Kent, WA 98032", "12 OBrien Ave S, Kent, WA 98032"],
  ["45 Smith-Jones Rd, Yelm, WA 98597", "45 Smith Jones Rd, Yelm, WA 98597"],
  ["9 Cañon Dr, Yakima, WA 98901", "9 Canon Dr, Yakima, WA 98901"],
  // A compass point or the kind of street left out on one side.
  ["123 Main St, Kent, WA 98032", "123 N Main St, Kent, WA 98032"],
  ["13013 224th St, Graham, WA 98338", "13013 224th St E, Graham, WA 98338"],
  ["77 Broadway, Seattle, WA 98102", "77 Broadway E, Seattle, WA 98102"],
  // Homes in a building, and townhouses with a letter.
  ["500 Main St Unit 4, Kent, WA 98032", "500 Main St, Unit 4, Kent, WA 98032"],
  ["500 Main St #4, Kent, WA 98032", "500 Main St, Apt 4, Kent, WA 98032"],
  ["500 Main St, Apt. 12-B, Kent, WA 98032", "500 Main St, Unit 12B, Kent, WA 98032"],
  ["500 Main St Unit 01, Kent, WA 98032", "500 Main St, Unit 1, Kent, WA 98032"],
  ["4121 A Whitman Ave N, Seattle, WA 98103", "4121 Whitman Ave N, Unit A, Seattle, WA 98103"],
  ["4121 Whitman Ave N #A, Seattle, WA 98103", "4121A Whitman Ave N, Seattle, WA 98103"],
  ["4121A Whitman Ave N, Seattle, WA 98103", "4121 Whitman Ave N, Apt A, Seattle, WA 98103"],
  ["700 Pine St Bldg C Unit 201, Seattle, WA 98101", "700 Pine St, Bldg C, Unit 201, Seattle, WA 98101"],
  // No zip code: the city says where.
  ["4821 Orchard Loop Rd, Fixture Falls, WA", "4821 Orchard Loop Rd, Fixture Falls, WA 98000"],
  ["4821 Orchard Loop Rd, Fixture Falls", "4821 Orchard Loop Rd, Fixture Falls, WA 98000"],
  // The same zip code under another city's name (a post office serves more than one).
  ["19000 Aurora Ave N, Shoreline, WA 98133", "19000 Aurora Ave N, Seattle, WA 98133"],
  // Forms from elsewhere, written the same on both sides.
  ["N1234 County Rd X, Watertown, WI 53094", "N1234 County Rd X, Watertown, WI 53094"],
  ["1234 E 4500 S, Salt Lake City, UT 84117", "1234 E 4500 S, Salt Lake City, UT 84117"],
  ["45200 12 Mile Rd, Novi, MI 48377", "45200 12 Mile Rd, Novi, MI 48377"],
  ["One Main St, Kent, WA 98032", "One Main St, Kent, WA 98032"],
  ["RR 2 Box 15, Roy, WA 98580", "RR 2 Box 15, Roy, WA 98580"],
  ["1601 Space Center Blvd, Kent, WA 98032", "1601 Space Center Blvd, Kent, WA 98032"],
  ["77 Unity Dr Apt 4, Kent, WA 98032", "77 Unity Dr, Apt 4, Kent, WA 98032"],
  // A compass point written after the name on one side and before it on the other.
  ["100 Main St N, Kent, WA 98032", "100 N Main St, Kent, WA 98032"],
  // Units named in letters, with a hyphen, or after a "#".
  ["500 Main St #A-1, Kent, WA 98032", "500 Main St, Unit A-1, Kent, WA 98032"],
  ["500 Main St Apt B-204, Kent, WA 98032", "500 Main St, Apt B204, Kent, WA 98032"],
  ["500 Main St Unit PH1, Kent, WA 98032", "500 Main St, Unit PH1, Kent, WA 98032"],
  ["500 Main St UNIT PH, Kent, WA 98032", "500 Main St, # PH, Kent, WA 98032"],
  ["500 Main St Apt # 12, Kent, WA 98032", "500 Main St, #12, Kent, WA 98032"],
  ["500 Main St, Penthouse, Kent, WA 98032", "500 Main St, Penthouse, Kent, WA 98032"],
  // No comma between the street and the city (a page that gives them in two pieces), the city of one word or several.
  ["1500 S 336th St Federal Way, WA 98003", "1500 S 336th St, Federal Way, WA 98003"],
  ["4121 Harborview Dr Gig Harbor, WA 98332", "4121 Harborview Dr, Gig Harbor, WA 98332"],
  ["7500 27th St W University Place, WA 98466", "7500 27th St W, University Place, WA 98466"],
  ["1234 Mill Creek Blvd Mill Creek, WA 98012", "1234 Mill Creek Blvd, Mill Creek, WA 98012"],
  ["456 Ballarat Ave N North Bend, WA 98045", "456 Ballarat Ave N, North Bend, WA 98045"],
  ["21630 11th Ave S Des Moines, WA 98198", "21630 11th Ave S, Des Moines, WA 98198"],
  ["1820 Main St Lake Stevens WA 98258", "1820 Main St, Lake Stevens, WA 98258"],
  ["500 Main St Unit PH1 Kent, WA 98032", "500 Main St, Unit PH1, Kent, WA 98032"],
  ["100 Kent St Kent, WA 98032", "100 Kent St, Kent, WA 98032"],
  ["100 Main St Hartford, CT 06101", "100 Main St, Hartford, CT 06101"],
  // ...and under another city's name for the same zip code, where that name is plainly a name.
  ["19000 Aurora Ave N Shoreline, WA 98133", "19000 Aurora Ave N, Seattle, WA 98133"],
  ["13013 224th St E Frederickson, WA 98338", "13013 224th St E, Graham, WA 98338"],
  // With its comma in place, another name for the city may end in the record's ("North Puyallup"): the comma says where the street ends.
  ["1215 5th St SE, North Puyallup, WA 98372", "1215 5th St SE, Puyallup, WA 98372"],
  ["100 Main St, West Seattle, WA 98116", "100 Main St, Seattle, WA 98116"],
  ["450 Main Ave S, South Cle Elum, WA 98943", "450 Main Ave S, Cle Elum, WA 98943"],
  // A county is not a unit and not a city.
  ["13013 224th St E, Graham, Pierce County, WA 98338", "13013 224th St E, Graham, WA 98338"],
  // A name written as two words or as one, whichever of its words a record shortens.
  ["100 Lake Shore Dr, Kent, WA 98032", "100 Lakeshore Dr, Kent, WA 98032"],
  ["100 Lk Shore Dr, Kent, WA 98032", "100 Lakeshore Dr, Kent, WA 98032"],
  ["100 Hill Crest Rd, Kent, WA 98032", "100 Hillcrest Rd, Kent, WA 98032"],
  ["100 River Side Dr, Kent, WA 98032", "100 Riverside Dr, Kent, WA 98032"],
  // A unit before the street, with no space after "Apt", and one whose name has a hyphen between two numbers.
  ["Unit 4, 500 Main St, Kent, WA 98032", "500 Main St, Unit 4, Kent, WA 98032"],
  ["500 Main St Apt#4, Kent, WA 98032", "500 Main St, Apt 4, Kent, WA 98032"],
  ["500 Main St Apt 11-2, Kent, WA 98032", "500 Main St, Unit 11-2, Kent, WA 98032"],
  ["500 Main St #1/2, Kent, WA 98032", "500 Main St, Unit 1-2, Kent, WA 98032"],
  // A street that is called what the city is, with no city given; a city and its state at the end with no comma and no zip.
  ["100 Federal Way, WA 98003", "100 Federal Way, Federal Way, WA 98003"],
  ["1820 Main St Lake Stevens WA", "1820 Main St, Lake Stevens, WA 98258"],
  // Words a record shortens, a number without its ending, the half as one character, a letter hung on the number.
  ["100 Tiger Mountain Rd SE, Issaquah, WA 98027", "100 Tiger Mtn Rd SE, Issaquah, WA 98027"],
  ["4000 W Lake Sammamish Pkwy SE, Bellevue, WA 98008", "4000 W Lk Sammamish Pkwy SE, Bellevue, WA 98008"],
  ["100 Harbor View Landing, Gig Harbor, WA 98335", "100 Harbor View Lndg, Gig Harbor, WA 98335"],
  ["13013 224 St E, Graham, WA 98338", "13013 224th St E, Graham, WA 98338"],
  ["4121½ Whitman Ave N, Seattle, WA 98103", "4121 1/2 Whitman Ave N, Seattle, WA 98103"],
  ["4121-B Whitman Ave N, Seattle, WA 98103", "4121 Whitman Ave N, Unit B, Seattle, WA 98103"],
  // A street named by a word that is also a kind of street, with a compass word written out or short.
  ["14500 North Creek Dr, Mill Creek, WA 98012", "14500 N Creek Dr, Mill Creek, WA 98012"],
  ["425 E North Bend Way, North Bend, WA 98045", "425 E N Bend Way, North Bend, WA 98045"],
  ["23705 North Ridge Ave, University Place, WA 98467", "23705 N Ridge Ave, University Place, WA 98467"],
  ["500 Main St PH 3, Kent, WA 98032", "500 Main St, Unit PH3, Kent, WA 98032"],
  ["500 Main St Lot 4, Kent, WA 98032", "500 Main St, Space 4, Kent, WA 98032"],
  // A houseboat's slip, a floor, a room.
  ["2025 Fairview Ave E Slip 12, Seattle, WA 98102", "2025 Fairview Ave E, Slip 12, Seattle, WA 98102"],
  ["500 Main St Fl 2, Kent, WA 98032", "500 Main St, Floor 2, Kent, WA 98032"],
  // The state written out, with a full stop, or with no comma before it; the country as "US".
  ["100 Main St, Kent, Washington 98032", "100 Main St, Kent, WA 98032"],
  ["100 Main St, Kent, Washington", "100 Main St, Kent, WA 98032"],
  ["100 Main St, Kent WA", "100 Main St, Kent, WA 98032"],
  ["100 Main St., Kent, WA. 98032", "100 Main St, Kent, WA 98032"],
  ["100 Main St, Kent, WA 98032, US", "100 Main St, Kent, WA 98032"],
  ["100 Main St, Albany, New York 12207", "100 Main St, Albany, NY 12207"],
  // A comma put in the middle of the city's name (a link read by the last-word rule).
  ["100 Main St Maple, Falls, WA 98266", "100 Main St, Maple Falls, WA 98266"],
  ["100 Main St Santa, Fe, NM 87501", "100 Main St, Santa Fe, NM 87501"],
  // Highways and the Key Peninsula's own compass points.
  ["14915 St Rt 302 NW, Gig Harbor, WA 98329", "14915 State Route 302 NW, Gig Harbor, WA 98329"],
  ["14915 WA-302 NW, Gig Harbor, WA 98329", "14915 State Route 302 NW, Gig Harbor, WA 98329"],
  ["14915 State Route 302 KPN, Gig Harbor, WA 98329", "14915 SR 302 KPN, Gig Harbor, WA 98329"],
  ["9013 Key Peninsula Hwy, Lakebay, WA 98349", "9013 Key Peninsula Hwy KPN, Lakebay, WA 98349"],
  // A street called like a kind of street or a state, and a street that ends in the city's own name with no city given.
  ["500 Auburn Way S, WA 98002", "500 Auburn Way S, Auburn, WA 98002"],
  ["12 Court St, Tacoma, WA 98402", "12 Court St, Tacoma, WA 98402"],
];

const DIFFERENT: [asked: string, onRecord: string, why: string][] = [
  ["13015 224th St E, Graham, WA 98338", "13013 224th St E, Graham, WA 98338", "another number"],
  ["1301 224th St E, Graham, WA 98338", "13013 224th St E, Graham, WA 98338", "a number that starts the same"],
  ["123 S 56th St, Tacoma, WA 98408", "123 1/2 S 56th St, Tacoma, WA 98408", "the half number is another door"],
  ["4821 Orchard Loop Rd, Fixture Falls, WA 98000", "4823 Orchard Loop Rd, Fixture Falls, WA 98000", "the house next door"],
  ["13013 225th St E, Graham, WA 98338", "13013 224th St E, Graham, WA 98338", "another street"],
  ["13013 224th St E, Graham, WA 98338", "13013 224th St Ct E, Graham, WA 98338", "Street is not Street Court"],
  ["13013 224th St E, Graham, WA 98338", "13013 224th Ave E, Graham, WA 98338", "Street is not Avenue"],
  ["12345 15th Ave NE, Seattle, WA 98125", "12345 15th Pl NE, Seattle, WA 98125", "Avenue is not Place"],
  ["100 N Main St, Kent, WA 98032", "100 S Main St, Kent, WA 98032", "north is not south"],
  ["13013 224th St E, Graham, WA 98338", "13013 224th St W, Graham, WA 98338", "east is not west"],
  ["100 N St, Tacoma, WA 98403", "100 North St, Tacoma, WA 98403", "N Street is not North Street"],
  ["100 E St, Tacoma, WA 98421", "100 East St, Tacoma, WA 98421", "E Street is not East Street"],
  ["13013 224th St E, Graham, WA 98339", "13013 224th St E, Graham, WA 98338", "another zip code"],
  ["4821 Orchard Loop Rd, Other Town, WA", "4821 Orchard Loop Rd, Fixture Falls, WA 98000", "no zip code, another town"],
  ["4821 Orchard Loop Rd", "4821 Orchard Loop Rd, Fixture Falls, WA 98000", "no zip code and no town: it could be anywhere"],
  ["500 Main St Unit 4, Kent, WA 98032", "500 Main St, Unit 12, Kent, WA 98032", "another unit"],
  ["500 Main St, Kent, WA 98032", "500 Main St, Unit 12, Kent, WA 98032", "which unit was not said"],
  ["500 Main St Unit 4, Kent, WA 98032", "500 Main St, Kent, WA 98032", "the record is the building's"],
  ["700 Pine St Bldg C Unit 201, Seattle, WA 98101", "700 Pine St, Bldg C, Unit 305, Seattle, WA 98101", "the same building, another unit"],
  ["77 Unity Dr Apt 4, Kent, WA 98032", "77 Unity Dr, Apt 7, Kent, WA 98032", "another unit on a street called Unity"],
  ["9 Lott Rd Apt 4, Kent, WA 98032", "9 Lott Rd, Apt 7, Kent, WA 98032", "another unit on a street called Lott"],
  ["4121 A Whitman Ave N, Seattle, WA 98103", "4121 Whitman Ave N, Unit B, Seattle, WA 98103", "townhouse A is not townhouse B"],
  ["Lot 12, 4821 Orchard Loop Rd, Fixture Falls, WA 98000", "4821 Orchard Loop Rd, Fixture Falls, WA 98000", "a lot on the property is not the house"],
  ["9116 State Route 9, Lake Stevens, WA 98258", "9116 State Route 92, Lake Stevens, WA 98258", "another highway"],
  ["the blue house on 224th", "13013 224th St E, Graham, WA 98338", "not an address"],
  ["", "13013 224th St E, Graham, WA 98338", "nothing asked"],
  ["13013 224th St E, Graham, WA 98338", "somewhere in Graham", "not a record's address"],
  // Units the first rule could not read, and so took for no unit at all.
  ["500 Main St, Unit PH1, Kent, WA 98032", "500 Main St, Unit A-1, Kent, WA 98032", "another unit, named in letters and a number"],
  ["500 Main St, Unit A-1, Kent, WA 98032", "500 Main St, Unit B-2, Kent, WA 98032", "another unit, with a hyphen"],
  ["500 Main St, Unit AB, Kent, WA 98032", "500 Main St, Unit CD, Kent, WA 98032", "another unit, named in two letters"],
  ["500 Main St, Kent, WA 98032", "500 Main St, Unit PH1, Kent, WA 98032", "which unit was not said, and the record's is named in letters"],
  ["500 Main St, Unit PH1, Kent, WA 98032", "500 Main St, Kent, WA 98032", "the record is the building's, and the unit is named in letters"],
  ["500 Main St, Kent, WA 98032", "500 Main St, Penthouse, Kent, WA 98032", "a part of the building the rule has no word for"],
  ["500 Main St, Rear, Kent, WA 98032", "500 Main St, Front, Kent, WA 98032", "two parts of a building the rule has no word for"],
  ["500 Main St #PH, Kent, WA 98032", "500 Main St #PJ, Kent, WA 98032", "another unit after a #"],
  ["1500 S 336th St Federal Way, WA 98003", "1500 S 336th St, Unit 4, Federal Way, WA 98003", "no comma, and the record is one unit's"],
  // A compass point on the other side of the name is still another compass point.
  ["100 N Main St, Kent, WA 98032", "100 Main St S, Kent, WA 98032", "north before the name is not south after it"],
  // The number as written.
  ["500-4 Main St, Kent, WA 98032", "5004 Main St, Kent, WA 98032", "a hyphen in the number is not nothing"],
  // The state, and what only looks like one.
  ["100 Main St, Portland, ME", "100 Main St, Portland, OR 97201", "a town of the same name in another state"],
  ["100 Main St, Portland, ME", "100 Main St, Portland, OR", "the same, with no zip code on either side"],
  ["123 Main St, 98032", "123 Main Ave, Kent, WA 98032", "St before the zip code is the kind of street, not a state"],
  ["123 Main Ct, 98032", "123 Main Ave, Kent, WA 98032", "Ct before the zip code is Court, not Connecticut"],
  ["123 45th St NE, 98105", "123 45th St NW, Seattle, WA 98105", "NE before the zip code is northeast, not Nebraska"],
  ["123 Evergreen Wy, 98201", "123 Evergreen Ct, Everett, WA 98201", "Wy before the zip code is Way, not Wyoming"],
  // No comma before the city: the street must still be the whole street.
  ["13013 224th St Ct E Graham, WA 98338", "13013 224th St E, Graham, WA 98338", "Street Court, written without a comma"],
  ["100 Lake Washington Blvd Seattle, WA 98122", "100 Lake St, Seattle, WA 98122", "a longer street that starts the same"],
  ["100 Main Vista Seattle, WA 98133", "100 Main St, Shoreline, WA 98133", "another street, another city's name, no comma"],
  ["100 Main St Ct Shoreline, WA 98133", "100 Main St, Seattle, WA 98133", "Street Court under another city's name"],
  ["100 Main Line Dr Shoreline, WA 98133", "100 Main, Seattle, WA 98133", "a record without a kind of street says too little"],
  ["100 Main St E Shoreline, WA 98133", "100 Main St, Seattle, WA 98133", "a compass word after the record's street may be more street"],
  ["12345 Meridian E South Hill, WA 98373", "12345 Meridian S, Puyallup, WA 98373", "Meridian East is not Meridian South"],
  ["12345 Meridian Ave E South Hill, WA 98373", "12345 Meridian E, Puyallup, WA 98373", "the kind of street is the record's own, or it is not known to be the street"],
  ["100 Main St 5 Shoreline, WA 98133", "100 Main St, Seattle, WA 98133", "a number after the street is not a city"],
  ["9013 Key Peninsula Hwy NW, Lakebay, WA 98349", "9013 Key Peninsula Hwy KPS, Lakebay, WA 98349", "northwest is not the Key Peninsula's south"],
  ["2025 Fairview Ave E Slip 12, Seattle, WA 98102", "2025 Fairview Ave E, Slip 14, Seattle, WA 98102", "another slip"],
  ["13013 224th St E, Graham, WA 98338", "13013 2240th St E, Graham, WA 98338", "another numbered street"],
  ["4121 1/2 Whitman Ave N, Seattle, WA 98103", "4121 Whitman Ave N, Seattle, WA 98103", "the half as one character or three is still another door"],
  ["100 N Ridge Ave, Kent, WA 98032", "100 S Ridge Ave, Kent, WA 98032", "north Ridge is not south Ridge"],
  ["100 Main St E Santa, Fe, NM 87501", "100 Main St W, Santa Fe, NM 87501", "a comma in the city's name does not make east west"],
  // A street's name that ends in a word for a kind of street, against one side that gives no kind at all.
  ["100 Mill, Kent, WA 98032", "100 Mill Creek Rd, Kent, WA 98032", "Mill is not known to be Mill Creek Road"],
  ["100 Harbor, Gig Harbor, WA 98335", "100 Harbor View Dr, Gig Harbor, WA 98335", "Harbor is not known to be Harbor View Drive"],
  ["100 Park Ridge View Ct, Kent, WA 98032", "100 Park, Kent, WA 98032", "nor the other way round"],
  // A building, a floor or a penthouse of a number is not the unit of that number.
  ["500 Main St Bldg 4, Kent, WA 98032", "500 Main St, Apt 4, Kent, WA 98032", "building 4 is not apartment 4"],
  ["500 Main St Bldg C Unit 201, Kent, WA 98032", "500 Main St, Bldg 201, Unit C, Kent, WA 98032", "building C unit 201 is not building 201 unit C"],
  ["500 Main St Fl 2, Kent, WA 98032", "500 Main St, Unit 2, Kent, WA 98032", "the second floor is not unit 2"],
  ["500 Main St PH 3, Kent, WA 98032", "500 Main St, Unit 3, Kent, WA 98032", "penthouse 3 is not unit 3"],
  ["100 Main St, Vancouver, Washington", "100 Main St, Vancouver, BC", "Washington is not British Columbia"],
  ["100 Main St, Kent, Oregon", "100 Main St, Kent, WA 98032", "a state written out is still another state"],
  ["100 Washington, Kent, WA 98032", "100 Washington St, Kent, OR 97033", "a street called Washington is not a state"],
  // The same three in the states they could be taken for: read as a state, the kind or the compass word would be lost.
  ["123 Main Ct, 06101", "123 Main Ave, Hartford, CT 06101", "Ct before the zip code is Court, in Connecticut too"],
  ["123 45th St NE, 68102", "123 45th St NW, Omaha, NE 68102", "NE before the zip code is northeast, in Nebraska too"],
  ["123 Evergreen Wy, 82001", "123 Evergreen Ct, Cheyenne, WY 82001", "Wy before the zip code is Way, in Wyoming too"],
  // A unit's name with a hyphen or a slash between two numbers is its name as written.
  ["500 Main St Apt 11-2, Kent, WA 98032", "500 Main St, Apt 1-12, Kent, WA 98032", "the hyphen stands elsewhere: another unit"],
  ["500 Main St Unit 2-1, Kent, WA 98032", "500 Main St, Apt 21, Kent, WA 98032", "2-1 is not 21"],
  ["500 Main St Unit 1-12, Kent, WA 98032", "500 Main St, Apt 112, Kent, WA 98032", "1-12 is not 112"],
  ["500 Main St #1/2, Kent, WA 98032", "500 Main St, Apt 12, Kent, WA 98032", "1/2 is not 12"],
  ["500 Main St Apt 1-2B, Kent, WA 98032", "500 Main St, Apt 12-B, Kent, WA 98032", "1-2B is not 12-B"],
  // No comma, another city's name: what follows the record's street must be a city's name and nothing else.
  ["5300 Lake St Clair Dr SE Lacey, WA 98513", "5300 Lake St, Olympia, WA 98513", "Lake Saint Clair Drive is not Lake Street"],
  ["100 E St Andrews Way Broadmoor, WA 98112", "100 E St, Seattle, WA 98112", "East Saint Andrews Way is not E Street"],
  ["100 Main St Rear Shoreline, WA 98133", "100 Main St, Seattle, WA 98133", "the house at the rear"],
  ["100 Main St A Shoreline, WA 98133", "100 Main St, Seattle, WA 98133", "unit A, written with no mark"],
  ["100 Mill Creek Park Dr Bothell, WA 98012", "100 Mill Creek, Mill Creek, WA 98012", "a longer street that begins with the record's"],
  ["100 Main St Mall Shoreline, WA 98133", "100 Main St, Seattle, WA 98133", "Main Street Mall is not Main Street"],
  ["100 Main St Mall, WA 98133", "100 Main St, Seattle, WA 98133", "the same with no city at all"],
  ["100 Park Ave Plaza Shoreline, WA 98133", "100 Park Ave, Seattle, WA 98133", "Park Avenue Plaza is not Park Avenue"],
  ["100 Main St Promenade Shoreline, WA 98133", "100 Main St, Seattle, WA 98133", "two words after the street are not taken for a city"],
  ["100 Main St Kent Des Moines, WA 98198", "100 Main St, Seattle, WA 98198", "three words after the street are not a city"],
  // A named building on the lot is not the house.
  ["500 Main St, Carriage House, Kent, WA 98032", "500 Main St, Kent, WA 98032", "the carriage house is not the house"],
];

/**
 * One house, as likely as not, written in a way the rule cannot tell from
 * another house's. It is turned away, and the person is told what came back:
 * better that than a guess. Kept here so that the choice is seen, and so
 * that accepting one of these is a decision somebody makes.
 */
const TURNED_AWAY: [asked: string, onRecord: string, why: string][] = [
  ["12345 Meridian E South Hill, WA 98373", "12345 Meridian E, Puyallup, WA 98373", "no comma, and another name for the city that begins with a compass word"],
  ["7500 27th St W University Place, WA 98466", "7500 27th St W, Tacoma, WA 98466", "no comma, and another name for the city that ends in a kind of street"],
  ["1500 S 336th St Federal Way, WA 98003", "1500 S 336th St, Auburn, WA 98003", "the same, with Way"],
  ["9116 State Route 9 Snohomish, WA 98258", "9116 State Route 9, Lake Stevens, WA 98258", "no comma, another city, and a street with no kind or compass word to end it"],
  ["21630 11th Ave S Des Moines, WA 98198", "21630 11th Ave S, Seattle, WA 98198", "no comma, and another name for the city in two words"],
  ["100 Main St Summit, WA 98444", "100 Main St, Tacoma, WA 98444", "no comma, and another name for the city that is also a word streets end in"],
  ["4121 Whitman Ave N, Wallingford, Seattle, WA 98103", "4121 Whitman Ave N, Seattle, WA 98103", "a neighbourhood between the street and the city reads like a unit"],
  ["4121 Whitman Ave N, Seattle, WA 98103", "4121 A Whitman Ave N, Seattle, WA 98103", "the listing leaves out the letter the record has"],
  ["4121 E Whitman Ave N, Seattle, WA 98103", "4121 Whitman Ave N, Unit E, Seattle, WA 98103", "a unit's letter that is also a compass letter"],
  ["1234 Martin Luther King Jr Way S, Seattle, WA 98144", "1234 M L King Jr Way S, Seattle, WA 98144", "a name the record writes in initials"],
  ["100 Twenty First St, Kent, WA 98032", "100 21st St, Kent, WA 98032", "a number written in words past twentieth"],
  ["9013 Key Peninsula Hwy NW, Lakebay, WA 98349", "9013 Key Peninsula Hwy KPN, Lakebay, WA 98349", "the post office's compass word against the county's"],
];

test("one house written two ways is the same house", () => {
  const refused = SAME.filter(([asked, onRecord]) => !sameHouseAddress(asked, onRecord)).map(([asked, onRecord]) => `${asked}  |  ${onRecord}`);
  assert.deepEqual(refused, []);
});

test("two houses are two houses", () => {
  const taken = DIFFERENT.filter(([asked, onRecord]) => sameHouseAddress(asked, onRecord)).map(([asked, onRecord, why]) => `${why}: ${asked}  |  ${onRecord}`);
  assert.deepEqual(taken, []);
});

test("what cannot be told to be the same house is turned away, not guessed", () => {
  const taken = TURNED_AWAY.filter(([asked, onRecord]) => sameHouseAddress(asked, onRecord)).map(([asked, onRecord, why]) => `${why}: ${asked}  |  ${onRecord}`);
  assert.deepEqual(taken, []);
});

test("a record's address names its city: one that does not is not taken for a record's", () => {
  // Without commas nothing says where the street ends, and names are compared with their words run together:
  // "Main St Kent" and "Mainst Kent" would be one name. A record's address is never written that way.
  assert.equal(sameHouseAddress("100 Main St Kent WA 98032", "100 Mainst Kent, WA 98032"), false);
  assert.equal(sameHouseAddress("100 Main St, Kent, WA 98032", "100 Main St, WA 98032"), false);
  assert.equal(sameHouseAddress("100 Main St, Kent, WA 98032", "100 Main St, Unit 4"), false);
  assert.equal(sameHouseAddress("100 Main St, Kent, WA 98032", "100 Main St, Kent, WA 98032"), true);
});

test("an answer is kept under one name for one house, and never under one name for two", () => {
  // Every pair that is one house and gives the same place (zip or city) on both sides has one key...
  const split = SAME.filter(([asked, onRecord]) => {
    const [a, b] = [takeApart(asked), takeApart(onRecord, null)];
    // A compass point, a kind of street or a zip left out on one side is the same house, but nothing says so
    // without the record to hand: those are asked about under their own name, once.
    // Nor does an address without commas say where its street ends and its city begins.
    const complete = a.zip === b.zip && a.city === b.city && a.before.length === b.before.length && a.kinds.length === b.kinds.length && (a.after === null) === (b.after === null);
    return complete && addressKey(asked) !== addressKey(onRecord);
  }).map(([asked, onRecord]) => `${addressKey(asked)}  <>  ${addressKey(onRecord)}`);
  assert.deepEqual(split, []);
  // ...and no two different houses share one.
  const shared = DIFFERENT.filter(([asked, onRecord]) => asked !== "" && addressKey(asked) === addressKey(onRecord)).map(([asked, onRecord, why]) => `${why}: ${addressKey(asked)}  ==  ${addressKey(onRecord)}`);
  assert.deepEqual(shared, []);
  // The key is the house, not the writing.
  assert.equal(addressKey("4821 Orchard Loop Road,  Fixture Falls, WA 98000-1234, USA"), addressKey("4821 ORCHARD LOOP RD., fixture falls, wa 98000"));
  // An address without commas does not say where its street ends: it is kept as it was written, and matches itself.
  assert.equal(addressKey("4821 orchard loop rd fixture falls wa 98000"), addressKey("4821 Orchard Loop Rd Fixture Falls WA 98000"));
  assert.equal(addressKey("500 N. Main Street #4, Kent, WA 98032"), addressKey("500 North Main St Apt 4, Kent WA 98032"));
  assert.notEqual(addressKey("100 N St, Tacoma, WA 98403"), addressKey("100 North St, Tacoma, WA 98403"));
  assert.notEqual(addressKey("500 Main St Unit 4, Kent, WA 98032"), addressKey("500 Main St Unit 12, Kent, WA 98032"));
});

test("an address is taken apart the way it is written", () => {
  const apart = (address: string) => {
    const a = takeApart(address);
    return [a.number, a.units.join("+"), a.before.join(" "), a.name, a.kinds.join(" "), a.after ?? "", a.city ?? "", a.zip ?? ""].join(" | ");
  };
  assert.equal(apart("13013 224th St E, Graham, WA 98338"), "13013 |  |  | 224 | st | e | graham | 98338");
  assert.equal(apart("8208 243rd Street Ct E, Graham, WA 98338"), "8208 |  |  | 243 | st ct | e | graham | 98338");
  assert.equal(apart("2415 E North St, Seattle, WA 98112"), "2415 |  | e | north | st |  | seattle | 98112");
  assert.equal(apart("715 E E St, Tacoma, WA 98421"), "715 |  | e | e | st |  | tacoma | 98421");
  assert.equal(apart("1234 Avenue D, Snohomish, WA 98290"), "1234 |  |  | aved |  |  | snohomish | 98290");
  assert.equal(apart("123 1/2 S 56th St, Tacoma, WA 98408"), "123 1/2 |  | s | 56 | st |  | tacoma | 98408");
  assert.equal(apart("4121 A Whitman Ave N, Seattle, WA 98103"), "4121 | a |  | whitman | ave | n | seattle | 98103");
  assert.equal(apart("700 Pine St, Bldg C, Unit 201, Seattle, WA 98101"), "700 | 201+bldgc |  | pine | st |  | seattle | 98101");
  assert.equal(apart("9116 State Route 9 NE, Lake Stevens, WA 98258"), "9116 |  |  | hwy9 |  | ne | lakestevens | 98258");
  assert.equal(apart("300 Pacific Hwy S, Des Moines, WA 98198"), "300 |  |  | pacific | hwy | s | desmoines | 98198");
});

test("a hostile address is taken apart without delay", () => {
  for (const address of ["1 ".repeat(100_000), `${"apt ".repeat(50_000)}4`, `1${" n".repeat(100_000)} st, x, wa 98000`, "#".repeat(200_000), `${"a,".repeat(100_000)}wa 98000`, `1${" n".repeat(140)} st, x, wa 98000`, `${"#1 ".repeat(90)}`]) {
    const started = performance.now();
    assert.equal(sameHouseAddress(address, "13013 224th St E, Graham, WA 98338"), false);
    assert.equal(sameHouseAddress("13013 224th St E, Graham, WA 98338", address), false);
    addressKey(address);
    assert.ok(performance.now() - started < 200, `${address.slice(0, 20)}… took ${Math.round(performance.now() - started)} ms`);
  }
  // Text too long to be an address is not read as one, even when an address stands at its start.
  assert.equal(sameHouseAddress(`13013 224th St E, Graham, WA 98338${" ".repeat(400)}`, "13013 224th St E, Graham, WA 98338"), false);
});

/**
 * Houses made from parts, each written the way a record writes it and the
 * ways a listing does. The tables above hold the cases somebody thought of;
 * this holds the combinations nobody did. `npm test` reads a spread of them;
 * FLIP_ADDRESSES=full reads forty times as many.
 */
interface Made {
  number: string;
  unit: string;
  pre: string;
  name: string[];
  kinds: string[];
  post: string;
  city: string;
  zip: string;
}
const NUMBERS = ["13013", "8208", "123", "4121", "500", "12", "1301", "23705", "100", "9116"];
const UNITS = ["", "", "", "", "4", "12", "A", "B", "201", "12B", "PH1", "A-1"];
const POINTS = ["", "", "N", "S", "E", "W", "NE", "NW", "SE", "SW"];
const NAMES = [["224th"], ["243rd"], ["Main"], ["Whitman"], ["45th"], ["Orchard"], ["Mt", "Baker"], ["Key", "Peninsula"], ["Mill", "Creek"], ["Harbor", "View"], ["Broadway"], ["Pacific"], ["Meridian"], ["Canyon"], ["St", "Helens"], ["Pt", "Fosdick"], ["Lake", "Sammamish"], ["North", "Shore"], ["Park"], ["Ridge"], ["View", "Ridge"], ["1st"], ["4th"]];
const KINDS = [["St"], ["Ave"], ["St", "Ct"], ["Ave", "Ct"], ["Rd"], ["Dr"], ["Pl"], ["Way"], ["Hwy"], ["Blvd"], ["Ln"], ["Ct"], ["Loop"], []];
const PLACES: [string, string][] = [["Graham", "98338"], ["Seattle", "98103"], ["Federal Way", "98003"], ["Gig Harbor", "98335"], ["Kent", "98032"], ["Lake Stevens", "98258"], ["Tacoma", "98444"], ["University Place", "98467"], ["North Bend", "98045"], ["Mill Creek", "98012"]];
const WRITTEN_OUT: Record<string, string> = { St: "Street", Ave: "Avenue", Rd: "Road", Dr: "Drive", Pl: "Place", Hwy: "Highway", Blvd: "Boulevard", Ln: "Lane", Ct: "Court", N: "North", S: "South", E: "East", W: "West", NE: "Northeast", NW: "Northwest", SE: "Southeast", SW: "Southwest", Mt: "Mount", Pt: "Point", "1st": "First", "4th": "Fourth" };
/** How a listing writes the pieces of an address together. The last two give no comma before the city. */
const FORMS = ["commas", "the zip's four more digits", "capitals", "no comma before the state", "no comma before the city", "no commas at all"] as const;

function generated(count: number) {
  let seed = 20261125;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const make = (): Made => {
    const [city, zip] = pick(PLACES);
    return { number: pick(NUMBERS), unit: pick(UNITS), pre: pick(POINTS), name: pick(NAMES), kinds: pick(KINDS), post: pick(POINTS), city, zip };
  };
  /** As a record writes it: short words, a comma between every piece, the unit in a piece of its own. */
  const onRecord = (h: Made) => `${[h.number, h.pre, ...h.name, ...h.kinds, h.post].filter(Boolean).join(" ")}${h.unit ? `, ${pick(["Unit", "Apt", "#"])} ${h.unit}` : ""}, ${h.city}, WA ${h.zip}`;
  /** As a listing may: `words` says which of the compass words, kinds and names are written out; `form` how the pieces are joined. */
  const asListed = (h: Made, words: number, form: number) => {
    const out = (word: string, bit: number) => (words & bit ? (WRITTEN_OUT[word] ?? word) : word);
    const street = [h.number, out(h.pre, 1), ...h.name.map((w) => out(w, 8)), ...h.kinds.map((k) => out(k, 2)), out(h.post, 4)].filter(Boolean).join(" ");
    const unit = h.unit ? ` ${pick(["#", "Unit ", "APT ", "Apt "])}${h.unit}` : "";
    return [`${street}${unit}, ${h.city}, WA ${h.zip}`, `${street}${unit}, ${h.city}, WA ${h.zip}-1234`, `${street}${unit}, ${h.city}, WA ${h.zip}`.toUpperCase(), `${street}${unit}, ${h.city} WA ${h.zip}`, `${street}${unit} ${h.city}, WA ${h.zip}`, `${street}${unit} ${h.city} WA ${h.zip}`][form];
  };
  /** The same house with one part made another: a part that says something else, not one that is merely left out. */
  const other = (h: Made): [Made, string] | null => {
    const part = pick(["number", "unit", "pre", "name", "kinds", "post", "place"] as const);
    const b = { ...h };
    if (part === "number") b.number = pick(NUMBERS);
    if (part === "unit") b.unit = pick(UNITS);
    if (part === "pre") b.pre = pick(POINTS);
    if (part === "name") b.name = pick(NAMES);
    if (part === "kinds") b.kinds = pick(KINDS);
    if (part === "post") b.post = pick(POINTS);
    if (part === "place") [b.city, b.zip] = pick(PLACES);
    if (JSON.stringify(b) === JSON.stringify(h)) return null;
    // A compass word or a kind left out on one side is "not said", which the rule lets pass on purpose. A compass
    // word that only moved to the other side of the name is the same street written the other way.
    const points = (x: Made) => [x.pre, x.post].filter(Boolean).sort().join(" ");
    if ((part === "pre" || part === "post") && (points(h) === "" || points(b) === "" || points(h) === points(b))) return null;
    if (part === "kinds" && (h.kinds.length === 0 || b.kinds.length === 0) && h.kinds.length + b.kinds.length === 1) return null;
    return [b, part];
  };
  return { count, make, onRecord, asListed, other };
}

test("generated addresses: a house is itself however it is written, and never another house", () => {
  const g = generated(process.env.FLIP_ADDRESSES === "full" ? 40_000 : 1_000);
  const turnedAway: string[] = [];
  const taken: string[] = [];
  const oneKey: string[] = [];
  const twoKeys: string[] = [];
  let pairs = 0;
  for (let i = 0; i < g.count; i++) {
    const house = g.make();
    const record = g.onRecord(house);
    const plain = g.asListed(house, 0, 0);
    for (let form = 0; form < FORMS.length; form++) {
      // Each form with nothing written out, with everything written out, and with one mixture.
      for (const words of [0, 15, (i * 7 + form) % 16]) {
        pairs++;
        const asked = g.asListed(house, words, form);
        if (!sameHouseAddress(asked, record)) turnedAway.push(`${FORMS[form]}: ${asked}  |  ${record}`);
        // With its commas in place a house has one key, however its words are spelled.
        if (form < 3 && addressKey(asked) !== addressKey(plain)) twoKeys.push(`${asked}  <>  ${plain}`);
      }
    }
    const changed = g.other(house);
    if (!changed) continue;
    const [another, part] = changed;
    for (let form = 0; form < FORMS.length; form++) {
      pairs++;
      const asked = g.asListed(house, (i + form) % 16, form);
      if (sameHouseAddress(asked, g.onRecord(another))) taken.push(`another ${part}, ${FORMS[form]}: ${asked}  |  ${g.onRecord(another)}`);
    }
    if (addressKey(plain) === addressKey(g.asListed(another, 0, 0))) oneKey.push(`another ${part}: ${plain}  ==  ${g.asListed(another, 0, 0)}`);
  }
  assert.ok(pairs > 20_000, `${pairs} pairs`);
  assert.deepEqual(taken.slice(0, 10), [], `${taken.length} pairs of two houses were called one`);
  assert.deepEqual(oneKey.slice(0, 10), [], `${oneKey.length} pairs of two houses share a key`);
  assert.deepEqual(turnedAway.slice(0, 10), [], `${turnedAway.length} of ${pairs} writings of a house were turned away`);
  assert.deepEqual(twoKeys.slice(0, 10), [], `${twoKeys.length} writings of one house have a key of their own`);
});
