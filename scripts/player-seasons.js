import fs from 'fs';
import * as d3 from 'd3';
import cheerio from 'cheerio';
import shell from 'shelljs';

const MIN_YEAR = 1976;

const USE = {
	basic: [
		'Season',
		'Age',
		'Tm',
		'Lg',
		'G',
		'MP',
		'FG%',
		'FT%',
		'TRB',
		'AST',
		'STL',
		'BLK',
		'PTS'
	],
	advanced: ['Season', 'Tm', 'PER', 'WS', 'WS/48', 'BPM', 'VORP']
};

// const data = d3.csvParse(
// 	fs.readFileSync('./output/all-players--joined.csv', 'utf-8')
// );

const data = d3.csvParse(
	fs.readFileSync('./output/all-players--bbr.csv', 'utf-8')
);

const pipmData = d3.csvParse(fs.readFileSync('./input/pipm.csv', 'utf-8'));

const nestedPipm = d3
	.nest()
	.key(d => d.Player)
	.entries(pipmData);

function getValues($, tr, cols, bbrID) {
	const values = $(tr)
		.find('td,th')
		.map((i, td) => ({ index: i, value: $(td).text() }))
		.get();

	const colsIndex = cols.map(d => d.index);

	const filtered = values.filter(d => colsIndex.includes(d.index)).map(d => ({
		value: d.value,
		prop: cols.find(c => c.index === d.index).name
	}));

	const season = { bbrID };

	filtered.forEach(d => {
		season[d.prop] = d.value;
	});

	return season;
}

function getSeasonStats(bbrID, html, table) {
	if (!html) return [];
	const $ = cheerio.load(html);
	const $table = $('table');
	const columnNames = $table
		.find('thead th')
		.map((i, el) =>
			$(el)
				.text()
				.trim()
		)
		.get();

	const columns = columnNames.map((d, i) => ({ index: i, name: d }));
	const columnsFiltered = columns.filter(d => USE[table].includes(d.name));

	const $rows = $table.find('tbody tr');
	const seasons = [];
	$rows.each((i, tr) => seasons.push(getValues($, tr, columnsFiltered, bbrID)));

	return seasons;
}

function getAwardStats(html) {
	if (!html) return [];
	const $ = cheerio.load(html);
	const awards = $('#leaderboard_all_league tbody td')
		.map((i, el) => {
			const season = $(el)
				.find('a')
				.text()
				.trim();

			$(el)
				.find('a')
				.remove();
			const award = $(el)
				.text()
				.trim();
			return { Season: season, Award: award || '' };
		})
		.get();

	return awards.filter(
		d => !d.Award.includes('Defensive') && !d.Award.includes('Rookie')
	);
}

function getSalaryStats(html) {
	if (!html) return [];
	const $ = cheerio.load(html);
	const $table = $('table');

	const $rows = $table.find('tbody tr');
	const seasons = [];
	$rows.each((i, tr) => {
		seasons.push({
			Season: $(tr)
				.find('th')
				.eq(0)
				.text()
				.trim(),
			Tm: $(tr)
				.find('td')
				.eq(0)
				.text()
				.trim(),
			Lg: $(tr)
				.find('td')
				.eq(1)
				.text()
				.trim(),
			Salary: $(tr)
				.find('td')
				.eq(2)
				.text()
				.trim()
				.replace(/[^0-9]/g, '')
		});
	});
	return seasons;
}

function getContractStats(html) {
	// TODO replace each time if needed
	const Season = '2018-19';
	if (!html) return [];
	const $ = cheerio.load(html);
	const $table = $('table');
	if ($table.length) {
		const thead = $table.find('.thead');
		const i = $(thead)
			.find(`th[data-stat=${Season}]`)
			.index();
		const money = $table
			.find('tbody tr td')
			.eq(i)
			.text();
		const Salary = money.replace(/[^0-9]/g, '');

		const Tm = $table
			.find('tbody tr td')
			.eq(0)
			.text();
		return { Season, Tm, Salary, Lg: 'NBA' };
	}

	return null;
}

function getAdvancedHTML($) {
	return $('#all_advanced')
		.contents()
		.map((i, node) => (node.type === 'comment' ? node.data : null))
		.get()[0];
}

function getSalaryHTML($) {
	return $('#all_all_salaries')
		.contents()
		.map((i, node) => (node.type === 'comment' ? node.data : null))
		.get()[0];
}

function getContractHTML($) {
	return $('#all_all_salaries')
		.next()
		.contents()
		.map((i, node) => (node.type === 'comment' ? node.data : null))
		.get()[0];
}

function getAwardHTML($) {
	return $('#all_leaderboard')
		.contents()
		.map((i, node) => (node.type === 'comment' ? node.data : null))
		.get()[0];
}

function joinStats(player, basic, advanced, award, salary, hs) {
	const joined = basic.map(b => {
		const advancedMatch = advanced.find(
			a => a.Season === b.Season && a.Tm === b.Tm
		);
		const awardMatch = award.find(w => w.Season === b.Season) || {};
		const salaryMatch = salary.find(w => w.Season === b.Season) || {};

		const nestedPipmMatch = nestedPipm.find(w => w.key === player.name);
		const pipmMatch = nestedPipmMatch
			? nestedPipmMatch.values.find(
				w => w.Season === b.Season && w.Team === b.Tm
			  )
			: {};

		return {
			...player,
			HS: hs,
			PIPM: pipmMatch ? pipmMatch.PIPM : null,
			'Wins Added': pipmMatch ? pipmMatch['Wins Added'] : null,
			...advancedMatch,
			Award: '',
			...awardMatch,
			...salaryMatch,
			...b
		};
	});

	// change team if TOT (they changed halway thru)
	const tots = joined.filter(d => d.Tm === 'TOT').map(d => d.Season);

	// remove actual teams
	const others = joined.filter(d => tots.includes(d.Season) && d.Tm !== 'TOT');
	const withoutDupes = joined.filter(
		d => !(tots.includes(d.Season) && d.Tm !== 'TOT')
	);

	const withOthers = withoutDupes.map(d => ({
		...d,
		Team:
			d.Tm === 'TOT'
				? others
					.filter(o => o.Season === d.Season)
					.map(s => s.Tm)
					.join(',')
				: d.Tm
	}));

	return withOthers;
}

function getHighSchool($) {
	let hs = null;
	$('#meta')
		.find('p')
		.each((i, el) => {
			const t = $(el).text();
			if (t.includes('High School:')) {
				hs = t
					.replace(/\n/g, '')
					.replace(/\s{2,}/g, ' ')
					.replace('High School:', '')
					.trim();
			}
		});
	return hs;
}

function getSeasons(player, i) {
	const tempID = player.link.replace('/players/', '').replace('.html', '');
	const bbrID = tempID.split('/')[1];

	console.log(d3.format('.1%')(i / data.length), i, bbrID);
	const file = fs.readFileSync(`./output/player-pages/${bbrID}.html`, 'utf-8');
	const $ = cheerio.load(file);

	const hs = getHighSchool($);

	const basic = $.html('#all_per_game');
	const basicStats = getSeasonStats(bbrID, basic, 'basic');

	// SUPER hacky to convert comments into html but it works
	const advanced = getAdvancedHTML($);
	const advancedStats = getSeasonStats(bbrID, advanced, 'advanced');

	// SUPER hacky to convert comments into html but it works
	const awards = getAwardHTML($);
	const awardStats = getAwardStats(awards);

	// SUPER hacky to convert comments into html but it works
	const salary = getSalaryHTML($);
	const salaryStats = getSalaryStats(salary);

	// SUPER hacky to convert comments into html but it works
	const contract = getContractHTML($);
	const contractStats = getContractStats(contract);

	if (contractStats) salaryStats.push(contractStats);

	// join all stats together
	const joinedStats = joinStats(
		player,
		basicStats,
		advancedStats,
		awardStats,
		salaryStats,
		hs
	);

	// filter out pre merger
	const mergerStats = joinedStats.filter(
		d => +d.Season.split('-')[0] >= MIN_YEAR
	);

	const csv = d3.csvFormat(mergerStats);
	fs.writeFileSync(`./output/player-seasons/${bbrID}.csv`, csv);
}

data.forEach(getSeasons);

// join
const all = [];
data.forEach(d => {
	const tempID = d.link.replace('/players/', '').replace('.html', '');
	const bbrID = tempID.split('/')[1];
	const temp = d3.csvParse(
		fs.readFileSync(`./output/player-seasons/${bbrID}.csv`, 'utf8')
	);
	all.push(...temp);
});

const output = d3.csvFormat(all);
fs.writeFileSync('./output/player-seasons--all.csv', output);

