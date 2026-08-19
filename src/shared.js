import React, { useState, useEffect } from 'react';

/* "No match" is only true once someone has STOPPED typing. Mid-word a query is
   almost always unmatched, and an async lookup may still be in flight, so showing
   the message immediately means showing it wrongly. Returns true only after the
   value has held still for `ms`. */
export function useSettled(value, ms = 5000) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const t = setTimeout(() => setSettled(true), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/* ------------------------------------------------------------------ */
/* SHARED CONSTANTS, HELPERS, ICONS & MINI-COMPONENTS                  */
/* Extracted from App.js when the dashboard moved to a tabbed layout. */
/* ------------------------------------------------------------------ */

export const CW = [
  {y:1993,BU:100936,FA:41121,GA:111622,GL:85737,MU:1927,RA:3225,RO:85892},
  {y:1994,BU:90383,FA:39773,GA:94523,GL:75459,MU:1582,RA:3196,RO:72550},
  {y:1995,BU:75649,FA:35528,GA:71798,GL:65425,MU:1181,RA:3018,RO:59733},
  {y:1996,BU:61986,FA:30615,GA:59465,GL:58690,MU:984,RA:2888,RO:49324},
  {y:1997,BU:54866,FA:30259,GA:51312,GL:55686,MU:767,RA:2783,RO:44335},
  {y:1998,BU:47181,FA:28848,GA:43315,GL:51461,MU:629,RA:2476,RO:39003},
  {y:1999,BU:41348,FA:25962,GA:38976,GL:50139,MU:667,RA:2089,RO:35654},
  {y:2000,BU:36858,FA:25881,GA:35596,GL:49398,MU:671,RA:2067,RO:31892},
  {y:2001,BU:31773,FA:23020,GA:29607,GL:46291,MU:649,RA:1930,RO:27827},
  {y:2002,BU:31150,FA:20717,GA:26344,GL:45810,MU:586,RA:1966,RO:25858},
  {y:2003,BU:28614,FA:18722,GA:23147,GL:46502,MU:596,RA:1946,RO:22769},
  {y:2004,BU:25428,FA:18124,GA:20294,GL:47952,MU:570,RA:1758,RO:21100},
  {y:2005,BU:22119,FA:17282,GA:17875,GL:47451,MU:540,RA:1650,RO:19759},
  {y:2006,BU:20398,FA:17010,GA:15770,GL:46254,MU:593,RA:1504,RO:18431},
  {y:2007,BU:18841,FA:17228,GA:13256,GL:44863,MU:496,RA:1305,RO:17705},
  {y:2008,BU:18364,FA:16002,GA:12493,GL:43920,MU:523,RA:1281,RO:16631},
  {y:2009,BU:16624,FA:16631,GA:10681,GL:39272,MU:471,RA:1206,RO:16055},
  {y:2010,BU:16225,FA:16950,GA:10334,GL:37838,MU:536,RA:1373,RO:16182},
  {y:2011,BU:15506,FA:18482,GA:9315,GL:38504,MU:515,RA:1420,RO:16968},
  {y:2012,BU:17235,FA:19381,GA:8093,GL:42497,MU:419,RA:1445,RO:17858},
  {y:2013,BU:16979,FA:20297,GA:7400,GL:45368,MU:335,RA:1378,RO:17872},
  {y:2014,BU:15208,FA:20207,GA:7664,GL:43862,MU:333,RA:1352,RO:16638},
  {y:2015,BU:13071,FA:20271,GA:7332,GL:44007,MU:352,RA:1438,RO:16804},
  {y:2016,BU:11808,FA:20847,GA:6327,GL:44279,MU:335,RA:1438,RO:15654},
  {y:2017,BU:10627,FA:20051,GA:5676,GL:43148,MU:292,RA:1449,RO:14419},
  {y:2018,BU:9768,FA:20208,GA:5428,GL:43558,MU:295,RA:1794,RO:13787},
  {y:2019,BU:10778,FA:20695,GA:5430,GL:43247,MU:319,RA:1755,RO:13369},
  {y:2020,BU:15478,FA:20569,GA:9037,GL:35502,MU:468,RA:1427,RO:13108},
  {y:2021,BU:12811,FA:22835,GA:10415,GL:40870,MU:488,RA:1491,RO:12571},
  {y:2022,BU:15745,FA:26061,GA:13750,GL:51566,MU:438,RA:1617,RO:17411},
  {y:2023,BU:13773,FA:27876,GA:15795,GL:50586,MU:391,RA:1455,RO:16910},
  {y:2024,BU:13067,FA:29452,GA:14193,GL:48445,MU:382,RA:1749,RO:16574},
  {y:2025,BU:12826,FA:29841,GA:13532,GL:48107,MU:309,RA:2049,RO:15092},
];

export const MA_CW = {2000:57304,2001:57753,2002:52469,2003:51298,2004:52158,2005:52408,2006:52169,2007:51429,2008:50310,2009:50216,2010:52716,2011:50972,2012:54495,2013:53738,2014:53847,2015:42654,2016:42422,2017:41665,2018:43126,2019:42529,2020:33400,2021:36553,2022:41161,2023:44151,2024:47738};

// Multiplied by 10 to shift from /10k to /100k
export const PC = [
  {n:'100th',pov:13.9,fa:193,ma:467,ta:660,fs:29.3,sh:9,ha:1012,pl:821,gl:245},
  {n:'101st',pov:20.7,fa:493,ma:725,ta:1218,fs:40.5,sh:15,ha:1560,pl:1171,gl:244},
  {n:'102nd',pov:11.1,fa:208,ma:400,ta:608,fs:34.2,sh:2,ha:703,pl:820,gl:224},
  {n:'103rd',pov:13.8,fa:656,ma:881,ta:1537,fs:42.7,sh:8,ha:1559,pl:1749,gl:521},
  {n:'104th',pov:10.4,fa:160,ma:340,ta:500,fs:32.0,sh:2,ha:613,pl:731,gl:380},
  {n:'105th',pov:7.9,fa:114,ma:202,ta:316,fs:36.1,sh:0,ha:471,pl:348,gl:206},
  {n:'106th',pov:9.4,fa:261,ma:475,ta:736,fs:35.5,sh:4,ha:730,pl:903,gl:404},
  {n:'107th',pov:12.4,fa:157,ma:342,ta:499,fs:31.4,sh:2,ha:591,pl:639,gl:368},
  {n:'108th',pov:9.3,fa:235,ma:440,ta:675,fs:34.8,sh:1,ha:822,pl:1245,gl:638},
  {n:'109th',pov:14.2,fa:157,ma:378,ta:535,fs:29.4,sh:3,ha:600,pl:1046,gl:419},
  {n:'10th',pov:11.6,fa:287,ma:584,ta:871,fs:33.0,sh:4,ha:1073,pl:1585,gl:1155},
  {n:'110th',pov:13.9,fa:349,ma:623,ta:972,fs:35.9,sh:5,ha:669,pl:1349,gl:435},
  {n:'111th',pov:7.7,fa:100,ma:186,ta:286,fs:35.0,sh:2,ha:497,pl:432,gl:426},
  {n:'112th',pov:8.6,fa:137,ma:262,ta:399,fs:34.4,sh:1,ha:627,pl:1607,gl:348},
  {n:'113th',pov:10.7,fa:282,ma:537,ta:819,fs:34.4,sh:8,ha:915,pl:806,gl:326},
  {n:'114th',pov:12.3,fa:286,ma:493,ta:779,fs:36.7,sh:6,ha:1029,pl:1287,gl:509},
  {n:'115th',pov:14.5,fa:328,ma:662,ta:990,fs:33.1,sh:1,ha:578,pl:854,gl:449},
  {n:'120th',pov:14.6,fa:365,ma:726,ta:1091,fs:33.4,sh:8,ha:1392,pl:1000,gl:297},
  {n:'121st',pov:12.6,fa:193,ma:478,ta:671,fs:28.8,sh:1,ha:1061,pl:1032,gl:331},
  {n:'122nd',pov:8.3,fa:179,ma:263,ta:442,fs:40.4,sh:1,ha:761,pl:703,gl:290},
  {n:'123rd',pov:5.8,fa:94,ma:222,ta:316,fs:29.8,sh:0,ha:605,pl:402,gl:280},
  {n:'13th',pov:10.3,fa:305,ma:656,ta:961,fs:31.7,sh:1,ha:911,pl:3119,gl:1337},
  {n:'14th',pov:14.3,fa:2131,ma:4525,ta:6656,fs:32.0,sh:12,ha:4071,pl:16233,gl:6815},
  {n:'17th',pov:6.7,fa:127,ma:266,ta:393,fs:32.3,sh:0,ha:643,pl:1286,gl:756},
  {n:'18th',pov:11.3,fa:507,ma:1141,ta:1648,fs:30.8,sh:7,ha:1592,pl:3782,gl:2665},
  {n:'19th',pov:7.0,fa:104,ma:194,ta:298,fs:35.0,sh:0,ha:488,pl:1400,gl:802},
  {n:'1st',pov:5.5,fa:204,ma:598,ta:802,fs:25.4,sh:0,ha:874,pl:4515,gl:1589},
  {n:'20th',pov:8.6,fa:92,ma:254,ta:346,fs:26.6,sh:1,ha:636,pl:1353,gl:686},
  {n:'23rd',pov:30.6,fa:597,ma:875,ta:1472,fs:40.6,sh:17,ha:1749,pl:1297,gl:626},
  {n:'24th',pov:12.4,fa:175,ma:330,ta:505,fs:34.7,sh:3,ha:654,pl:1611,gl:489},
  {n:'25th',pov:34.1,fa:700,ma:1288,ta:1988,fs:35.2,sh:13,ha:2201,pl:1573,gl:771},
  {n:'26th',pov:25.5,fa:326,ma:511,ta:837,fs:39.0,sh:10,ha:1069,pl:890,gl:757},
  {n:'28th',pov:20.5,fa:473,ma:879,ta:1352,fs:35.0,sh:17,ha:1450,pl:2766,gl:792},
  {n:'30th',pov:22.4,fa:259,ma:595,ta:854,fs:30.3,sh:3,ha:1229,pl:1127,gl:547},
  {n:'32nd',pov:25.5,fa:566,ma:879,ta:1445,fs:39.2,sh:21,ha:1852,pl:1183,gl:482},
  {n:'33rd',pov:21.0,fa:315,ma:466,ta:781,fs:40.3,sh:5,ha:780,pl:1007,gl:445},
  {n:'34th',pov:15.1,fa:265,ma:526,ta:791,fs:33.5,sh:7,ha:622,pl:1161,gl:484},
  {n:'40th',pov:39.0,fa:1024,ma:1312,ta:2336,fs:43.8,sh:28,ha:2219,pl:1947,gl:950},
  {n:'41st',pov:31.4,fa:997,ma:1243,ta:2240,fs:44.5,sh:21,ha:1977,pl:1485,gl:653},
  {n:'42nd',pov:36.1,fa:907,ma:1124,ta:2031,fs:44.7,sh:34,ha:2376,pl:1351,gl:667},
  {n:'43rd',pov:26.0,fa:456,ma:672,ta:1128,fs:40.4,sh:18,ha:1118,pl:1165,gl:613},
  {n:'44th',pov:33.1,fa:665,ma:908,ta:1573,fs:42.3,sh:17,ha:1388,pl:1162,gl:500},
  {n:'45th',pov:14.4,fa:292,ma:473,ta:765,fs:38.2,sh:9,ha:960,pl:1037,gl:626},
  {n:'46th',pov:33.8,fa:671,ma:873,ta:1544,fs:43.4,sh:17,ha:1180,pl:727,gl:498},
  {n:'47th',pov:19.4,fa:620,ma:804,ta:1424,fs:43.5,sh:19,ha:1244,pl:905,gl:609},
  {n:'48th',pov:38.9,fa:844,ma:1277,ta:2121,fs:39.8,sh:32,ha:2074,pl:1545,gl:702},
  {n:'49th',pov:17.5,fa:460,ma:590,ta:1050,fs:43.8,sh:7,ha:1161,pl:1527,gl:687},
  {n:'50th',pov:16.8,fa:216,ma:392,ta:608,fs:35.5,sh:7,ha:923,pl:1077,gl:533},
  {n:'52nd',pov:26.3,fa:664,ma:714,ta:1378,fs:48.2,sh:10,ha:1169,pl:1228,gl:637},
  {n:'5th',pov:23.3,fa:645,ma:946,ta:1591,fs:40.5,sh:2,ha:1346,pl:2694,gl:1542},
  {n:'60th',pov:25.3,fa:414,ma:797,ta:1211,fs:34.2,sh:10,ha:1038,pl:991,gl:406},
  {n:'61st',pov:15.3,fa:181,ma:336,ta:517,fs:34.9,sh:3,ha:539,pl:681,gl:348},
  {n:'62nd',pov:18.4,fa:129,ma:377,ta:506,fs:25.5,sh:1,ha:538,pl:784,gl:309},
  {n:'63rd',pov:10.0,fa:145,ma:321,ta:466,fs:31.1,sh:5,ha:878,pl:1182,gl:461},
  {n:'66th',pov:25.0,fa:118,ma:227,ta:345,fs:34.2,sh:0,ha:388,pl:503,gl:244},
  {n:'67th',pov:14.8,fa:483,ma:638,ta:1121,fs:43.1,sh:19,ha:1694,pl:766,gl:448},
  {n:'68th',pov:14.1,fa:114,ma:333,ta:447,fs:25.6,sh:0,ha:496,pl:753,gl:292},
  {n:'69th',pov:13.1,fa:271,ma:413,ta:684,fs:39.6,sh:12,ha:1018,pl:642,gl:337},
  {n:'6th',pov:6.8,fa:259,ma:628,ta:887,fs:29.2,sh:5,ha:652,pl:2578,gl:1841},
  {n:'70th',pov:15.3,fa:268,ma:426,ta:694,fs:38.7,sh:7,ha:693,pl:891,gl:286},
  {n:'71st',pov:18.2,fa:425,ma:555,ta:980,fs:43.3,sh:11,ha:1070,pl:930,gl:330},
  {n:'72nd',pov:17.0,fa:236,ma:470,ta:706,fs:33.4,sh:3,ha:458,pl:596,gl:293},
  {n:'73rd',pov:33.1,fa:884,ma:1195,ta:2079,fs:42.5,sh:36,ha:2036,pl:1371,gl:520},
  {n:'75th',pov:23.2,fa:526,ma:784,ta:1310,fs:40.1,sh:18,ha:1530,pl:1284,gl:452},
  {n:'76th',pov:13.4,fa:232,ma:421,ta:653,fs:35.5,sh:6,ha:830,pl:913,gl:403},
  {n:'77th',pov:18.1,fa:455,ma:481,ta:936,fs:48.6,sh:14,ha:1161,pl:845,gl:447},
  {n:'78th',pov:5.8,fa:208,ma:342,ta:550,fs:37.8,sh:7,ha:620,pl:1612,gl:537},
  {n:'79th',pov:27.8,fa:443,ma:573,ta:1016,fs:43.6,sh:15,ha:1274,pl:1346,gl:418},
  {n:'7th',pov:28.1,fa:385,ma:794,ta:1179,fs:32.7,sh:9,ha:1337,pl:2405,gl:814},
  {n:'81st',pov:22.0,fa:318,ma:636,ta:954,fs:33.3,sh:17,ha:1064,pl:963,gl:388},
  {n:'83rd',pov:22.2,fa:340,ma:728,ta:1068,fs:31.8,sh:11,ha:868,pl:927,gl:616},
  {n:'84th',pov:11.6,fa:595,ma:617,ta:1212,fs:49.1,sh:6,ha:1403,pl:2564,gl:1062},
  {n:'88th',pov:14.3,fa:317,ma:655,ta:972,fs:32.6,sh:13,ha:1533,pl:1120,gl:592},
  {n:'90th',pov:31.9,fa:226,ma:361,ta:587,fs:38.5,sh:4,ha:794,pl:975,gl:606},
  {n:'94th',pov:9.8,fa:204,ma:405,ta:609,fs:33.5,sh:6,ha:915,pl:1297,gl:830},
  {n:'9th',pov:23.2,fa:246,ma:652,ta:898,fs:27.4,sh:3,ha:930,pl:2163,gl:1099},
];
export const K7 = ['BU','FA','GA','GL','MU','RA','RO'];
export const CC = {BU:'#394882',FA:'#e7466d',GA:'#9b9fbc',GL:'#ff7c53',MU:'#050507',RA:'#cea9be',RO:'#217ebe'};
export const CL = {BU:'Burglary',FA:'Fel. Assault',GA:'Grand Larceny Auto',GL:'Grand Larceny',MU:'Murder',RA:'Rape',RO:'Robbery'};

// This dashboard's own repo. It hosts every file the page reads: data/latest_compstat.json
// (the weekly CompStat report, scraped from the NYPD's own workbooks by
// scripts/scrape_compstat.py), data/context.json (revision + volatility figures from
// scripts/build_context.py) and data/weekly_series/master.json.
export const REPO_SELF = "compstat-decoder";
export const GITHUB_USER = "Vital-City-NYC";
export const REPO_NAME = REPO_SELF;
export const CITYWIDE_POPULATION = 8804190; // 2020 Census
export const VOLATILITY_THRESHOLD = 30;

export const VC = {
  black: "#050507", white: "#fff", cloud: "#ddd", orange: "#ff7c53",
  periwinkle: "#9b9fbc", magenta: "#e7466d", charcoal: "#707175",
  indigo: "#394882", cerulean: "#217ebe", green: "#57aa4a"
};

export const VIOLENT_CRIMES = ["Murder", "Rape", "Robbery", "Fel. Assault", "Misd. Assault", "Shooting Inc.", "Shooting Vic.", "Hate Crimes"];
export const PROPERTY_CRIMES = ["Burglary", "Gr. Larceny", "G.L.A.", "Petit Larceny", "Retail Theft"];
export const TOURIST_PRECINCTS = ["14th Precinct", "18th Precinct", "22nd Precinct"];
// The four violent and three property offenses within the 7-felony major index.
export const MAJOR_VIOLENT = ["Murder", "Rape", "Robbery", "Fel. Assault"];
export const MAJOR_PROPERTY = ["Burglary", "Gr. Larceny", "G.L.A."];

export const FALLBACK_DATA = {
  "citywide": {
    "source": "Citywide",
    "report_period": { "week_start": "3/2/2026", "week_end": "3/8/2026" },
    "seven_major_felonies": {
      "Murder": { "year_to_date": { "current_year": 36, "prior_year": 61, "pct_change": -41.0 }, "historical": { "31_yr_pct": -89.9 } },
      "Rape": { "year_to_date": { "current_year": 384, "prior_year": 354, "pct_change": 8.5 }, "historical": { "31_yr_pct": -30.1 } },
      "Robbery": { "year_to_date": { "current_year": 2158, "prior_year": 2329, "pct_change": -7.3 }, "historical": { "31_yr_pct": -86.2 } },
      "Fel. Assault": { "year_to_date": { "current_year": 4349, "prior_year": 4455, "pct_change": -2.4 }, "historical": { "31_yr_pct": -32.4 } },
      "Burglary": { "year_to_date": { "current_year": 1898, "prior_year": 2421, "pct_change": -21.6 }, "historical": { "31_yr_pct": -89.5 } },
      "Gr. Larceny": { "year_to_date": { "current_year": 6715, "prior_year": 7120, "pct_change": -5.7 }, "historical": { "31_yr_pct": -55.7 } },
      "G.L.A.": { "year_to_date": { "current_year": 1845, "prior_year": 1977, "pct_change": -6.7 }, "historical": { "31_yr_pct": -83.5 } }
    },
    "additional_stats": {}
  }
};

// 2020 Census populations via John Keefe's census-by-precincts crosswalk
// (github.com/jkeefe/census-by-precincts). Patrol borough totals = sum of constituent precincts.
export const GEO_POPULATIONS = {
  "1st Precinct": 84799, "5th Precinct": 50598, "6th Precinct": 64643, "7th Precinct": 57985, "9th Precinct": 75951,
  "10th Precinct": 65570, "13th Precinct": 100050, "14th Precinct": 28050, "17th Precinct": 89367, "18th Precinct": 67528,
  "19th Precinct": 220261, "20th Precinct": 114575, "22nd Precinct": 129,
  "23rd Precinct": 74769, "24th Precinct": 107489, "25th Precinct": 50996, "26th Precinct": 50002, "28th Precinct": 49200,
  "30th Precinct": 60456, "32nd Precinct": 81240, "33rd Precinct": 71598, "34th Precinct": 108608,
  "40th Precinct": 100929, "41st Precinct": 54454, "42nd Precinct": 93755, "43rd Precinct": 188015, "44th Precinct": 150436,
  "45th Precinct": 130799, "46th Precinct": 132584, "47th Precinct": 163539, "48th Precinct": 89216, "49th Precinct": 119881,
  "50th Precinct": 106976, "52nd Precinct": 146888,
  "60th Precinct": 109024, "61st Precinct": 169513, "62nd Precinct": 198870, "63rd Precinct": 112652, "66th Precinct": 205377,
  "67th Precinct": 162446, "68th Precinct": 136071, "69th Precinct": 90763, "70th Precinct": 164568, "71st Precinct": 102000,
  "72nd Precinct": 133230, "73rd Precinct": 98506, "75th Precinct": 200994, "76th Precinct": 47789, "77th Precinct": 101267,
  "78th Precinct": 73203, "79th Precinct": 106039, "81st Precinct": 68921, "83rd Precinct": 120747, "84th Precinct": 65597,
  "88th Precinct": 64372, "90th Precinct": 131377, "94th Precinct": 72748,
  "100th Precinct": 50809, "101st Precinct": 73376,
  "102nd Precinct": 153297, "103rd Precinct": 121059, "104th Precinct": 178948, "105th Precinct": 199218, "106th Precinct": 129391,
  "107th Precinct": 161402, "108th Precinct": 137962, "109th Precinct": 269581, "110th Precinct": 181051, "111th Precinct": 122211,
  "112th Precinct": 119739, "113th Precinct": 135221, "114th Precinct": 208525, "115th Precinct": 179134,
  "120th Precinct": 122308, "121st Precinct": 128149, "122nd Precinct": 144552, "123rd Precinct": 100738,
  "Bronx South": 718388, "Bronx North": 759084, "Brooklyn South": 1705506, "Brooklyn North": 1030568, "Manhattan South": 684541, "Manhattan North": 989323, "Queens South": 1023773, "Queens North": 1397151, "Staten Island": 495747
};

export const PRECINCT_NEIGHBORHOODS = {
  "1st Precinct": "Tribeca, Wall St", "5th Precinct": "Chinatown, Little Italy", "6th Precinct": "Greenwich Village",
  "7th Precinct": "Lower East Side", "9th Precinct": "East Village", "10th Precinct": "Chelsea",
  "13th Precinct": "Gramercy, Stuy Town", "14th Precinct": "Midtown South", "17th Precinct": "Midtown East",
  "18th Precinct": "Midtown North", "19th Precinct": "Upper East Side", "20th Precinct": "Upper West Side",
  "22nd Precinct": "Central Park", "23rd Precinct": "East Harlem South", "24th Precinct": "Morningside Heights",
  "25th Precinct": "East Harlem North", "26th Precinct": "Manhattanville", "28th Precinct": "Central Harlem",
  "30th Precinct": "Hamilton Heights", "32nd Precinct": "Central Harlem North", "33rd Precinct": "Washington Heights",
  "34th Precinct": "Inwood, Wash. Heights", "40th Precinct": "Mott Haven", "41st Precinct": "Hunts Point",
  "42nd Precinct": "Morrisania", "43rd Precinct": "Soundview", "44th Precinct": "Highbridge",
  "45th Precinct": "Co-op City", "46th Precinct": "Fordham", "47th Precinct": "Wakefield",
  "48th Precinct": "East Tremont", "49th Precinct": "Pelham Parkway", "50th Precinct": "Riverdale",
  "52nd Precinct": "Bedford Park", "60th Precinct": "Coney Island", "61st Precinct": "Sheepshead Bay",
  "62nd Precinct": "Bensonhurst", "63rd Precinct": "Flatlands", "66th Precinct": "Borough Park",
  "67th Precinct": "East Flatbush", "68th Precinct": "Bay Ridge", "69th Precinct": "Canarsie",
  "70th Precinct": "Flatbush", "71st Precinct": "Crown Heights South", "72nd Precinct": "Sunset Park",
  "73rd Precinct": "Brownsville", "75th Precinct": "East New York", "76th Precinct": "Red Hook",
  "77th Precinct": "Crown Heights North", "78th Precinct": "Park Slope", "79th Precinct": "Bed-Stuy West",
  "81st Precinct": "Bed-Stuy East", "83rd Precinct": "Bushwick", "84th Precinct": "Brooklyn Heights, DUMBO",
  "88th Precinct": "Fort Greene", "90th Precinct": "Williamsburg", "94th Precinct": "Greenpoint",
  "100th Precinct": "Rockaways", "101st Precinct": "Far Rockaway", "102nd Precinct": "Richmond Hill",
  "103rd Precinct": "Jamaica", "104th Precinct": "Ridgewood, Maspeth", "105th Precinct": "Queens Village",
  "106th Precinct": "Ozone Park", "107th Precinct": "Fresh Meadows", "108th Precinct": "Long Island City",
  "109th Precinct": "Flushing", "110th Precinct": "Elmhurst", "111th Precinct": "Bayside",
  "112th Precinct": "Forest Hills", "113th Precinct": "South Jamaica", "114th Precinct": "Astoria",
  "115th Precinct": "Jackson Heights", "116th Precinct": "Rosedale, Laurelton",
  "120th Precinct": "St. George", "121st Precinct": "Bulls Head",
  "122nd Precinct": "New Dorp", "123rd Precinct": "Tottenville"
};

/* ------------------------------------------------------------------ */
/* HELPERS                                                             */
/* ------------------------------------------------------------------ */
export const safeNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const calcPct = (current, prior) => {
  const c = safeNum(current); const p = safeNum(prior);
  if (!p) return c === 0 ? 0 : null;
  return ((c - p) / p) * 100;
};
export const formatPct = (v) => (typeof v !== 'number' || Number.isNaN(v)) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
export const pctColor = (v) => v == null ? '#6b7280' : v > 0 ? '#d2232a' : v < 0 ? '#57aa4a' : '#6b7280';
// "Down 6.3%" / "Up 1.6%" / "No change" — how people actually talk about crime trends.
// Whole numbers drop the trailing ".0" (e.g. "Up 100%", not "Up 100.0%").
export const dirPct = (v, digits = 1) => {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—';
  if (v === 0) return 'No change';
  if (v < -100) v = -100; // a count cannot fall more than 100%; clamp so an upstream bug can never print an impossible decline
  const n = Math.abs(v).toFixed(digits).replace(/\.0$/, '');
  return `${v > 0 ? 'Up' : 'Down'} ${n}%`;
};
// "Down 3,365 offenses" / "Up 374 offenses" / "Up 1 incident" / "No change".
export const dirCount = (v, unit = '') => {
  if (typeof v !== 'number') return '—';
  if (v === 0) return 'No change';
  const u = unit && Math.abs(v) === 1 ? unit.replace(/s$/, '') : unit; // singular at 1
  return `${v > 0 ? 'Up' : 'Down'} ${Math.abs(v).toLocaleString()}${u ? ' ' + u : ''}`;
};
// Signed, labeled count: "-3,365 offenses" / "+374 offenses" / "-1 offense" / "No change".
export const signedCount = (v, unit = 'offenses') => {
  if (typeof v !== 'number') return '—';
  const n = Math.round(v);
  if (n === 0) return 'No change';
  const u = Math.abs(n) === 1 ? unit.replace(/s$/, '') : unit; // singular at 1
  return `${n > 0 ? '+' : '-'}${Math.abs(n).toLocaleString()} ${u}`;
};

// Expand compact CompStat crime labels to friendlier names for prose.
const EXPANDED_CRIME_NAMES = {
  'G.L.A.': 'grand larceny auto',
  'Gr. Larceny': 'grand larceny',
  'Fel. Assault': 'felony assault',
  'Misd. Assault': 'misdemeanor assault',
  'Shooting Vic.': 'shooting victims',
  'Shooting Inc.': 'shooting incidents',
  'UCR Rape*': 'UCR rape',
  'Murder': 'murder',
  'Burglary': 'burglary',
  'Robbery': 'robbery',
  'Rape': 'rape',
  'Petit Larceny': 'petit larceny',
  'Retail Theft': 'retail theft',
  'Transit': 'transit',
  'Housing': 'housing',
  'Hate Crimes': 'hate crimes',
  'Traffic Fatalities': 'traffic fatalities',
  'Other Sex Crimes': 'other sex crimes',
};
export const expandCrime = (name) => EXPANDED_CRIME_NAMES[name] || (name || '').toLowerCase();
export const expandCrimeTitle = (name) => {
  const exp = expandCrime(name);
  return exp.replace(/\b\w/g, c => c.toUpperCase());
};

// Person vs. property classification for color-blind redundant cue.
const PERSON_OFFENSES = new Set(['Murder', 'Rape', 'Robbery', 'Fel. Assault', 'Misd. Assault', 'Shooting Vic.', 'Shooting Inc.', 'UCR Rape*', 'Other Sex Crimes', 'Hate Crimes']);
const PROPERTY_OFFENSES = new Set(['Burglary', 'Gr. Larceny', 'G.L.A.', 'Petit Larceny', 'Retail Theft']);
export const offenseClass = (name) => PERSON_OFFENSES.has(name) ? 'Person' : PROPERTY_OFFENSES.has(name) ? 'Property' : null;

// Rates per 100k: a tenth of a point is meaningful at 4.2, noise at 406. Drop the decimal
// once the value reaches three figures.
export const formatRate = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1).replace(/\.0$/, '');
};

export const formatPop = (n) => {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  return Math.round(n / 1000) + 'k';
};
export const formatGeoName = (geo) => {
  if (PRECINCT_NEIGHBORHOODS[geo]) return `${geo} (${PRECINCT_NEIGHBORHOODS[geo]})`;
  return geo;
};

// Precincts take an article, patrol boroughs don't: "in the 40th Precinct", "in Bronx North".
// Carry it with the name so sentences don't have to guess.
export const geoWithArticle = (geo) =>
  (geo && geo.includes('Precinct')) ? `the ${geo}` : geo;
export const formatPeriodDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
};

// NYPD patrol borough for each precinct number — used to scope "patterns" rules
// to a borough and to check whether a precinct bucks its borough's trend.
const PATROL_BOROUGHS = {
  'Manhattan South': [1, 5, 6, 7, 9, 10, 13, 14, 17, 18],
  'Manhattan North': [19, 20, 22, 23, 24, 25, 26, 28, 30, 32, 33, 34],
  // NYPD split Patrol Borough Bronx in two on May 20, 2026 (Commissioner Tisch, PR008).
  // Precinct lines did not move, so every period — before or after the split — can be
  // grouped either way, which is how this app shows an unbroken history for both commands.
  'Bronx South': [40, 41, 42, 43, 44, 45],
  'Bronx North': [46, 47, 48, 49, 50, 52],
  'Brooklyn South': [60, 61, 62, 63, 66, 67, 68, 69, 70, 71, 72, 76, 78],
  'Brooklyn North': [73, 75, 77, 79, 81, 83, 84, 88, 90, 94],
  // The 116th opened in Rosedale in December 2024, out of the southern end of the 105th
  // and part of the 113th — the first wholly new NYPD command in over a decade.
  'Queens South': [100, 101, 102, 103, 105, 106, 107, 113, 116],
  'Queens North': [104, 108, 109, 110, 111, 112, 114, 115],
  'Staten Island': [120, 121, 122, 123],
};
export const PATROL_BOROUGH_NAMES = Object.keys(PATROL_BOROUGHS);
export const precinctPatrolBorough = (geoName) => {
  const num = parseInt(String(geoName).replace(/\D+/g, ''), 10);
  if (!num) return null;
  for (const [b, nums] of Object.entries(PATROL_BOROUGHS)) {
    if (nums.includes(num)) return b;
  }
  return null;
};

// Spell out small counts so sentences never start with a numeral.
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const numWord = (n, capitalize = false) => {
  const w = (n >= 0 && n <= 10) ? NUM_WORDS[n] : String(n);
  return capitalize ? w.charAt(0).toUpperCase() + w.slice(1) : w;
};

// crime_history.json stores citywide history as a list of {y, Crime: count} rows but
// precinct history as {year: {Crime: count}} — normalize the latter to the list shape
// the historical-context helpers expect.
export const precinctHistorySeries = (dict) => {
  if (!dict) return null;
  return Object.entries(dict)
    .map(([y, vals]) => ({ y: parseInt(y, 10), ...vals }))
    .sort((a, b) => a.y - b.y);
};

export const toOrdinalPrecinct = (n) => {
  const num = parseInt(n, 10);
  if ([11, 12, 13].includes(num % 100)) return num + "th Precinct";
  const last = num % 10;
  if (last === 1) return num + "st Precinct";
  if (last === 2) return num + "nd Precinct";
  if (last === 3) return num + "rd Precinct";
  return num + "th Precinct";
};

/* ------------------------------------------------------------------ */
/* PROVISIONAL-DATA NOTE                                               */
/* Current-year CompStat counts are revised upward as complaints are   */
/* reclassified; the prior-year comparison has effectively settled.    */
/* Magnitudes measured from 22 weekly snapshots of the CompStat feed   */
/* (3/1/26–7/26/26): +3.7% citywide backfill into weeks already        */
/* reported, against +0.04% for the 2025 baseline over the same span.  */
/* See John Hall, "The Real Crime Numbers," Vital City.                */
/* ------------------------------------------------------------------ */
export const REVISION_URL = 'https://www.vitalcitynyc.org/real-crime-numbers-nyc-nypd/';

// Every quantity here comes from contextData (data/context.json), rebuilt weekly. The
// generic sentence is the fallback when that fetch fails — it makes no numeric claim,
// so a stale or missing file can never leave a wrong figure on the page.
export const revisionTooltip = (contextData) => {
  const base = "The NYPD classifies a complaint when it is reported, then revises it as evidence arrives — a hospital exam upgrades a misdemeanor assault to a felony, a medical examiner rules a death a homicide.";
  const r = contextData?.revisions;
  if (!r || r.citywide_pct == null || r.prior_year_pct == null) return base;
  return `${base} Across ${contextData.n_snapshots} weekly snapshots of this feed (${contextData.window_start} to ${contextData.window_end}), current-year counts grew ${r.citywide_pct}% beyond the new weeks being added; the prior-year figures moved ${r.prior_year_pct}%.`;
};

export const ProvisionalNote = ({ year, contextData, className = '' }) => (
  <span className={`text-gray-400 ${className}`}>
    <span title={revisionTooltip(contextData)} className="cursor-help decoration-dotted decoration-gray-300 underline underline-offset-[3px]">
      {year} counts are preliminary
    </span>
    {' and typically revise '}
    <a href={REVISION_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">upward</a>
    {`; ${year - 1} has settled.`}
  </span>
);

/* ------------------------------------------------------------------ */
/* YEAR-TO-DATE VOLATILITY                                            */
/* Year-to-date is a window whose LENGTH changes — a few weeks in      */
/* January, a full year in December — so the percentage moves on its   */
/* own as the year fills in, with no revision involved. This reports   */
/* the range a given geography's figure has actually occupied.         */
/* ------------------------------------------------------------------ */
export const ytdVolatility = (contextData, key, kind = 'geo') => {
  const src = kind === 'council' ? contextData?.council_ytd_volatility : contextData?.ytd_volatility;
  return src?.[key] || null;
};

// Signed form ("−18.5%") rather than the site's usual "Down 18.5%", which reads badly
// inside a range.
const signedPct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1).replace(/\.0$/, '')}%`;

// "March 1, 2026" — the year matters, because this window restarts every January and the
// start date moves with it.
export const formatPeriodDateShort = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
};
export const formatPeriodDateFull = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

export const VOLATILITY_LABEL = 'Caution about interpreting year-to-date trends:';

export const volatilitySentence = (v, noun = 'precinct') => {
  const measure = noun === 'district' ? 'year-to-date weighted average' : 'year-to-date change';
  // Too few weeks into a new year to quote a range — say why the number is unsteady
  // without inventing figures.
  const why = "Early in the calendar year, this measure covers only a few weeks, so a handful of incidents swings the percentage hard; it steadies as the year advances.";
  // Too few weeks into a new year to quote a range — the explanation still stands alone.
  if (!v || v.insufficient || v.min == null) return why;
  return `${why} Since ${formatPeriodDateFull(v.from) || v.from}, this ${noun}'s ${measure} has ranged from ${signedPct(v.min)} to ${signedPct(v.max)}.`;
};

/* ------------------------------------------------------------------ */
/* ROLLING 52-WEEK WINDOW                                              */
/* Year-to-date is a window whose length changes through the year, so   */
/* the same percentage means different things in March and October.     */
/* A trailing 52 weeks against the 52 before it is always the same      */
/* length, so it stays comparable — Ratcliffe's objection to year-to-   */
/* date comparisons, answered without leaving CompStat.                 */
/*                                                                      */
/* Source is data/weekly_series/master.json, built by                   */
/* scripts/archive_weekly_series.py from CompStat 2.0's weekly series.  */
/* Those are NYPD's CURRENT counts for each past week, not the counts   */
/* published at the time — so past weeks arrive already revised.        */
/* ------------------------------------------------------------------ */
export const ROLLING_URL =
  `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_SELF}/main/data/rolling.json`;

/* ------------------------------------------------------------------ */
/* STALE GEOGRAPHY GUARD                                               */
/* NYPD publishes one workbook per geography, and they do not always   */
/* update together — on 2026-07-27 the Bronx patrol-borough file was   */
/* ten weeks behind every other file, so the site was showing a May    */
/* figure labelled as current. Each geography carries its own report   */
/* period, so any lag is detectable rather than silent.                */
/* ------------------------------------------------------------------ */
export const staleGeo = (rawData, geo) => {
  const cw = rawData?.citywide?.report_period?.week_end;
  const mine = rawData?.[geo]?.report_period?.week_end;
  if (!cw || !mine || cw === mine) return null;
  const a = new Date(cw), b = new Date(mine);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b >= a) return null;
  return { asOf: mine, current: cw, weeksBehind: Math.round((a - b) / (7 * 864e5)) };
};

export const renderMarkdown = (node) => {
  if (typeof node === 'string') {
    const parts = node.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="text-black">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  }
  if (React.isValidElement(node)) {
    const { children, ...rest } = node.props;
    if (children) {
      const processed = React.Children.map(children, child => renderMarkdown(child));
      return React.cloneElement(node, rest, processed);
    }
  }
  return node;
};

/* ------------------------------------------------------------------ */
/* ICONS                                                               */
/* ------------------------------------------------------------------ */
const Icon = ({ children, size = 16, className = "" }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>{children}</svg>
);
export const RefreshCw = (p) => <Icon {...p}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></Icon>;
export const TrendingUp = (p) => <Icon {...p}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></Icon>;
export const TrendingDown = (p) => <Icon {...p}><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></Icon>;
export const Activity = (p) => <Icon {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></Icon>;
export const MapPin = (p) => <Icon {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></Icon>;
export const Info = (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></Icon>;
export const Users = (p) => <Icon {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Icon>;
export const SearchIcon = (p) => <Icon {...p}><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/></Icon>;
export const Navigation = (p) => <Icon {...p}><polygon points="3 11 22 2 13 21 11 13 3 11"/></Icon>;
export const Link2 = (p) => <Icon {...p}><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></Icon>;
export const Download = (p) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></Icon>;
export const AlertTriangle = (p) => <Icon {...p}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></Icon>;
export const ShieldCheck = (p) => <Icon {...p}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></Icon>;
export const ArrowLeft = (p) => <Icon {...p}><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></Icon>;
export const ChevronDown = (p) => <Icon {...p}><polyline points="6 9 12 15 18 9"/></Icon>;
export const Target = (p) => <Icon {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></Icon>;

/* ------------------------------------------------------------------ */
/* CITY COMPARISON — Real-Time Crime Index (AH Datalytics)             */
/* ------------------------------------------------------------------ */
export const RTCI_CSV_URL = 'https://raw.githubusercontent.com/AH-Datalytics/rtci/main/docs/app_data/scorecard.csv';
export const rtciRate = (count, pop) => +((count / pop) * 100000).toFixed(1);

// Fallback data in case fetch fails
export const RTCI_FALLBACK = [
  { city: 'New York City', pop: 8184044, murder: 305, violent: 47211, property: 74331, isNYC: true },
  { city: 'Los Angeles',   pop: 3786018, murder: 225, violent: 25854, property: 86495 },
  { city: 'Chicago',       pop: 2628298, murder: 424, violent: 21595, property: 72438 },
  { city: 'Houston',       pop: 2304406, murder: 270, violent: 21219, property: 91409 },
  { city: 'Philadelphia',  pop: 1550843, murder: 221, violent: 12772, property: 67170 },
];
export const RTCI_FALLBACK_PERIOD = 'Dec 2025';
export const RTCI_FALLBACK_UPDATED = '2026-02-17';

// Comparison groups — cities must match agency_name in RTCI CSV
export const RTCI_GROUPS = [
  { key: 'largest10', label: '10 Largest', cities: ['New York City', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'Jacksonville'] },
  { key: 'northeast', label: 'Northeast', cities: ['New York City', 'Philadelphia', 'Baltimore', 'Boston', 'Pittsburgh', 'Washington', 'Buffalo'] },
];

export function parseRTCIcsv(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return null;
  const parseRow = (line) => {
    const vals = []; let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur.trim());
    return vals;
  };
  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow);
  const nameI = headers.indexOf('agency_name');
  const typeI = headers.indexOf('crime_type');
  const curI = headers.indexOf('current_year_ytd');
  const popI = headers.indexOf('population');
  const updI = headers.indexOf('last_updated');
  const rangeI = headers.indexOf('ytd_month_range');
  if (nameI < 0 || typeI < 0 || curI < 0 || popI < 0) return null;

  const cityMap = {};
  let period = '', updated = '';
  rows.forEach(r => {
    const name = r[nameI], type = r[typeI];
    const count = parseInt(r[curI], 10) || 0;
    const pop = parseInt(r[popI], 10) || 0;
    if (!period && r[rangeI]) period = r[rangeI].replace(/^.*?- /, '').replace('Jan - ', '').trim();
    if (!updated && r[updI]) updated = r[updI];
    if (!cityMap[name]) cityMap[name] = { city: name, pop, murder: 0, violent: 0, property: 0, isNYC: name === 'New York City' };
    if (type === 'murder') cityMap[name].murder = count;
    else if (type === 'violent_crime') cityMap[name].violent = count;
    else if (type === 'property_crime') cityMap[name].property = count;
    if (pop > 0) cityMap[name].pop = pop;
  });
  return { cities: cityMap, period, updated };
}

/* ------------------------------------------------------------------ */
/* COLOR SCALES                                                        */
/* ------------------------------------------------------------------ */
// Sequential color scale for choropleth: light neutral → orange → magenta
const CHOROPLETH_STOPS = [
  [0.0, [240, 240, 240]],
  [0.25, [255, 213, 189]],
  [0.5, [255, 124, 83]],
  [0.75, [231, 70, 109]],
  [1.0, [57, 72, 130]],
];
export const crimeColor = (rate, min, max) => {
  if (rate == null) return '#e5e5e5';
  const t = Math.min(1, Math.max(0, (rate - min) / (max - min || 1)));
  let lo = CHOROPLETH_STOPS[0], hi = CHOROPLETH_STOPS[CHOROPLETH_STOPS.length - 1];
  for (let i = 0; i < CHOROPLETH_STOPS.length - 1; i++) {
    if (t >= CHOROPLETH_STOPS[i][0] && t <= CHOROPLETH_STOPS[i + 1][0]) { lo = CHOROPLETH_STOPS[i]; hi = CHOROPLETH_STOPS[i + 1]; break; }
  }
  const s = (t - lo[0]) / (hi[0] - lo[0] || 1);
  const r = Math.round(lo[1][0] + s * (hi[1][0] - lo[1][0]));
  const g = Math.round(lo[1][1] + s * (hi[1][1] - lo[1][1]));
  const b = Math.round(lo[1][2] + s * (hi[1][2] - lo[1][2]));
  return `rgb(${r},${g},${b})`;
};

// Diverging color scale for YoY change: green (decrease) → neutral → red (increase)
export const changeColor = (pctChange, maxAbs) => {
  if (pctChange == null) return '#e5e5e5';
  const capped = Math.min(maxAbs, Math.max(-maxAbs, pctChange));
  const t = capped / (maxAbs || 1); // -1 to +1
  if (t < 0) {
    const s = Math.abs(t);
    return `rgb(${Math.round(240 - s * 195)},${Math.round(240 - s * 80)},${Math.round(240 - s * 185)})`;
  }
  const s = t;
  return `rgb(${Math.round(240 - s * 50)},${Math.round(240 - s * 170)},${Math.round(240 - s * 175)})`;
};

/* ------------------------------------------------------------------ */
/* SPARKLINES & HISTORICAL CONTEXT                                     */
/* ------------------------------------------------------------------ */
export const MiniSparkline = ({ points, width = 48, height = 16, minY }) => {
  if (!points || points.length < 2) return null;
  const min = minY !== undefined ? minY : Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pad = 2;
  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const trending = points[points.length - 1] > points[0];
  return (
    <svg width={width} height={height} className="inline-block align-middle">
      <polyline points={coords} fill="none" stroke={trending ? VC.orange : VC.green} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={parseFloat(coords.split(' ').pop().split(',')[0])} cy={parseFloat(coords.split(' ').pop().split(',')[1])} r="2" fill={trending ? VC.orange : VC.green} />
    </svg>
  );
};

// Map of CompStat row names to crime_history.json keys (for citywide annual history).
// Names not in this map will fall back to a 2-point sparkline.
export const HISTORICAL_KEY = {
  'Burglary': 'Burglary',
  'Fel. Assault': 'Fel. Assault',
  'G.L.A.': 'G.L.A.',
  'Gr. Larceny': 'Gr. Larceny',
  'Murder': 'Murder',
  'Rape': 'Rape',
  'Robbery': 'Robbery',
  'Misd. Assault': 'Misd. Assault',
  'Petit Larceny': 'Petit Larceny',
  'Shooting Inc.': 'Shooting Inc.',
};

// Returns historical-context info for a given offense row.
// Logic:
//   - Annualize the current YTD count using the prior-year YTD/prior-year-full-year ratio,
//     so we can compare to historical full-year values.
//   - Build a series of {y, val} for the last ~12 years.
//   - Compute pre-pandemic baseline (2017-2019 mean / range).
//   - Emit a primary "vs pre-pandemic" badge and an "outlier vs 5-yr norm" badge.
export function getHistoricalContext(history, item, currentYear) {
  const key = HISTORICAL_KEY[item.name];
  if (!key || !history || !history.length) return null;
  const series = history.filter(d => typeof d[key] === 'number').map(d => ({ y: d.y, val: d[key] }));
  if (series.length < 5) return null;

  const priorYearRow = series.find(d => d.y === currentYear - 1);
  const priorFull = priorYearRow?.val;
  // YTD fraction: how much of last full year happened in YTD-equivalent period.
  const ytdFrac = (priorFull && item.prior > 0 && priorFull > 0) ? (item.prior / priorFull) : null;
  const annualized = (ytdFrac && ytdFrac > 0.05) ? item.current / ytdFrac : item.current;

  // Pre-pandemic baseline: 2017-2019.
  const pre = series.filter(d => d.y >= 2017 && d.y <= 2019).map(d => d.val);
  let pandemicBadge = null;
  if (pre.length >= 2) {
    const preLow = Math.min(...pre);
    const preHigh = Math.max(...pre);
    const preMean = pre.reduce((a, b) => a + b, 0) / pre.length;
    if (annualized < preLow) {
      pandemicBadge = { kind: 'below', label: 'Below pre-pandemic low', tone: 'green' };
    } else if (annualized < preMean * 0.97) {
      pandemicBadge = { kind: 'belowAvg', label: 'Below pre-pandemic avg', tone: 'green' };
    } else if (annualized > preHigh * 1.03) {
      pandemicBadge = { kind: 'aboveHigh', label: 'Above pre-pandemic high', tone: 'orange' };
    } else if (annualized > preMean * 1.03) {
      pandemicBadge = { kind: 'above', label: 'Above pre-pandemic avg', tone: 'orange' };
    } else {
      pandemicBadge = { kind: 'at', label: 'Back at pre-pandemic level', tone: 'gray' };
    }
  }

  // 5-year recent z-score outlier (excluding current).
  const recent = series.filter(d => d.y >= currentYear - 6 && d.y < currentYear).map(d => d.val);
  let outlierBadge = null;
  if (recent.length >= 4) {
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
    const std = Math.sqrt(variance);
    if (std > 0) {
      const z = (annualized - mean) / std;
      if (z >= 2) outlierBadge = { kind: 'spike', label: '5-yr high outlier', tone: 'orange' };
      else if (z <= -2) outlierBadge = { kind: 'plunge', label: '5-yr low outlier', tone: 'green' };
    }
  }

  // Find the year-since superlative (e.g., "Lowest since 2014").
  const sinceSuperlative = (() => {
    if (annualized <= 0) return null;
    // Lowest since: find the most recent year (excluding current) where val <= annualized.
    let lowSince = null;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].y >= currentYear) continue;
      if (series[i].val < annualized) { lowSince = series[i].y + 1; break; }
    }
    if (lowSince && lowSince <= currentYear - 3) return { kind: 'low', label: `Lowest since ${lowSince}`, tone: 'green' };
    let highSince = null;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].y >= currentYear) continue;
      if (series[i].val > annualized) { highSince = series[i].y + 1; break; }
    }
    if (highSince && highSince <= currentYear - 3) return { kind: 'high', label: `Highest since ${highSince}`, tone: 'orange' };
    return null;
  })();

  return { series, annualized, ytdFrac, pandemicBadge, outlierBadge, sinceSuperlative, preLow: pre.length ? Math.min(...pre) : null, preHigh: pre.length ? Math.max(...pre) : null };
}

// Summarize how many of the 7 major felonies have returned to or fallen below their 2017-19
// pre-pandemic average, using YTD-to-annualized projection. Returns: { below, total, above:[...names] }.
export function getPrePandemicRecovery(felonies, history) {
  if (!felonies || !history || !history.length) return null;
  const result = { below: 0, total: 0, above: [], at: [] };
  felonies.forEach(f => {
    const key = HISTORICAL_KEY[f.name];
    if (!key) return;
    const series = history.filter(d => typeof d[key] === 'number').map(d => ({ y: d.y, val: d[key] }));
    const pre = series.filter(d => d.y >= 2017 && d.y <= 2019).map(d => d.val);
    if (pre.length < 2) return;
    const preMean = pre.reduce((a, b) => a + b, 0) / pre.length;
    // Annualize current YTD against last full year so the comparison is apples-to-apples.
    const lastFull = series.find(d => d.y === series[series.length - 1].y)?.val;
    const ytdFrac = (lastFull && f.prior > 0 && lastFull > 0) ? (f.prior / lastFull) : null;
    const annualized = (ytdFrac && ytdFrac > 0.05) ? f.current / ytdFrac : f.current;
    result.total += 1;
    if (annualized <= preMean) {
      result.below += 1;
    } else {
      result.above.push({ name: f.name, ratio: annualized / preMean, annualized });
    }
  });
  result.above.sort((a, b) => b.ratio - a.ratio);
  if (result.total === 0) return null;
  return result;
}

// Sparkline that renders a multi-year series with a pre-pandemic reference band and a "current" projection dot.
export const ContextSparkline = ({ series, annualized, preLow, preHigh, width = 80, height = 22 }) => {
  if (!series || series.length < 3) return null;
  const allVals = series.map(d => d.val).concat([annualized]);
  if (preLow != null) allVals.push(preLow);
  if (preHigh != null) allVals.push(preHigh);
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;
  const pad = 2;
  // The projection dot gets reserved space AFTER the history, so the connector always
  // points forward. (It used to clamp the dot left of the last point on wide sparklines,
  // drawing the connector backward over the trend line — read as a phantom cliff.)
  const dotSpace = 10;
  const xFor = (i, n) => pad + (i / Math.max(1, n - 1)) * (width - pad * 2 - dotSpace);
  const yFor = (v) => pad + (1 - (v - min) / range) * (height - pad * 2);

  // History points (excludes current year — current is rendered separately as the "annualized" dot)
  const histPoints = series.map((d, i) => `${xFor(i, series.length).toFixed(1)},${yFor(d.val).toFixed(1)}`).join(' ');
  const cx = width - 5;
  const cy = yFor(annualized);
  const trending = annualized > series[series.length - 1].val;

  return (
    <svg width={width} height={height} className="inline-block align-middle">
      {preLow != null && preHigh != null && (
        <rect x={pad} y={yFor(preHigh)} width={width - pad * 2} height={Math.max(1, yFor(preLow) - yFor(preHigh))} fill="#dbeafe" fillOpacity="0.55" />
      )}
      <polyline points={histPoints} fill="none" stroke="#9ca3af" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      {/* Connector from last historical point to the current-year dot */}
      <line
        x1={xFor(series.length - 1, series.length)} y1={yFor(series[series.length - 1].val)}
        x2={cx} y2={cy}
        stroke={trending ? VC.orange : VC.green} strokeWidth="1.25" strokeLinecap="round"
      />
      {/* White halo so the dot always reads against the gray line */}
      <circle cx={cx} cy={cy} r="4.5" fill="#ffffff" />
      <circle cx={cx} cy={cy} r="3.2" fill={trending ? VC.orange : VC.green} />
    </svg>
  );
};
