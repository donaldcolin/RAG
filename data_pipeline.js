function processData(rows) {
  const conv = (a, b) => b ? Math.round((a / b) * 100) : 0;

  const funnel = { leads: 0, registered: 0, knet: 0, knet_passed: 0, interview_present: 0, interview: 0, pac: 0, admitted: 0 };
  const byCampus = {};
  const byState = {};
  const bySource = {};
  const byCity = {};
  const byPair = {};
  const byBoard = {};
  const byMarks = {};
  const byOccupation = {};
  const byOwner = {};
  const campusMarketing = {}; // per-campus breakdown for playbook
  const stateByCampus = {};   // state → campus drilldown
  const sourceByCampus = {};  // source → campus drilldown

  const registrationImpact = {
    '1200 - Organic': { leads: 0, admits: 0 },
    '1200 - Non-Organic': { leads: 0, admits: 0 },
    '600 - Organic': { leads: 0, admits: 0 },
    '600 - Non-Organic': { leads: 0, admits: 0 }
  };
  const stateLeakage = {};
  const meritAffordability = {};
  const academicTrajectory = { Improved: { leads: 0, admits: 0 }, Consistent: { leads: 0, admits: 0 }, Dropped: { leads: 0, admits: 0 } };
  const knetFatigue = { Single: { leads: 0, admits: 0 }, Multiple: { leads: 0, admits: 0 } };
  const crossShopping = { Single: { leads: 0, admits: 0 }, Multiple: { leads: 0, admits: 0 } };
  const velocityIntelligence = { '< 7 Days': { leads: 0, admits: 0 }, '7-14 Days': { leads: 0, admits: 0 }, '15-30 Days': { leads: 0, admits: 0 }, '> 30 Days': { leads: 0, admits: 0 } };

  // === SALES INTELLIGENCE TRACKING ===
  const counsellorByState = {};   // owner → state → { leads, knet, admits }
  const pipelineRescue = [];      // leads who passed KNET/Interview but haven't paid
  const campusByState2 = {};      // state → campus → { leads, registered, knet, admits }



  const resolveCampusName = (campus) => {
    if (!campus) return [null, null];
    if (campus.includes('srm-ap')) return ['SRM University AP', 'srm-ap'];
    if (campus.includes('amet-kanathur')) return ['AMET (Kanathur)', 'amet-kanathur'];
    if (campus.includes('yenepoya-university-bangalore')) return ['Yenepoya Univ - Bangalore', 'yenepoya-university-bangalore'];
    if (campus.includes('yenepoya-university-mangalore')) return ['Yenepoya Univ - Mangalore', 'yenepoya-university-mangalore'];
    if (campus.includes('sju-chennai')) return ['St. Joseph Univ - Chennai', 'sju-chennai'];
    if (campus.includes('lpu-punjab')) return ['Lovely Professional Univ', 'lpu-punjab'];
    if (campus.includes('sgt-university')) return ['SGT University', 'sgt-university-haryana'];
    if (campus.includes('jecrc')) return ['JECRC University', 'jecrc-jaipur'];
    if (campus.includes('kare')) return ['Kalasalingam (KARE)', 'kare-krishnankoil'];
    if (campus.includes('kalvium')) return ['Kalvium Campus', 'kalvium-campus'];
    return [null, null];
  };

  const getCampus = (r) => {
    let fs = (r['Final slug'] || '').trim();
    let cs = (r['campus_slug'] || '').trim();
    let campus = (fs && !['-', '#N/A', 'None', 'Unknown'].includes(fs)) ? fs : cs;
    return resolveCampusName(campus);
  };

  const campusProfiles = {};

  // Utility to auto-initialize nested objects
  const initDict = (dict, key, defaultObj) => {
    if (!dict[key]) dict[key] = typeof defaultObj === 'function' ? defaultObj() : { ...defaultObj };
    return dict[key];
  };

  const toTitleCase = (str) => str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());

  const standardizeState = (str) => {
    let s = str.toLowerCase().replace(/[^a-z\s]/g, '').trim();
    const map = { 'tn': 'Tamil Nadu', 'tamilnadu': 'Tamil Nadu', 'rotn': 'Tamil Nadu', 'tnn': 'Tamil Nadu', 'tns': 'Tamil Nadu', 'tnt': 'Tamil Nadu', 'tnch': 'Tamil Nadu', 'up': 'Uttar Pradesh', 'blr': 'Karnataka', 'kar': 'Karnataka', 'kl': 'Kerala', 'ni': 'North India', 'rj': 'Rajasthan' };
    return map[s] || toTitleCase(str);
  };

  /**
   * Field priority: user-captured (A–AQ) > CRM fallback (AR–CF)
   * Always try the user-filled column first; fall back to CRM only if blank.
   */
  const userField = (r, userCol, crmCol) => {
    const u = (r[userCol] || '').trim();
    return u || (crmCol ? (r[crmCol] || '').trim() : '');
  };

  const uniqueRows = [];
  const seenKeys = new Set();
  for (let r of rows) {
    const email = (r['Email'] || r['email'] || '').trim().toLowerCase();
    const phone = (r['Mobile Number'] || r['mobile_number'] || '').trim();
    const key = email || phone;
    if (!key) {
      uniqueRows.push(r);
    } else if (!seenKeys.has(key)) {
      uniqueRows.push(r);
      seenKeys.add(key);
    }
  }
  rows = uniqueRows;

  for (let r of rows) {
    if ((r['Lead Source'] || '').trim() === 'SRM.AP_Univ_2026') continue;

    const amt = parseInt(r['amount']);
    const is_paid = (r['1st Year fee payment'] || '').trim() === 'Paid';
    const is_pac = is_paid || (r['PAC'] || '').trim() === 'PAC Completed';

    const iv_status = (r['Knet Interview all status'] || '').trim();
    const iv_verdict = (r['Knet Interview verdict'] || '').trim();

    const is_interview_cleared = is_pac || iv_status.match(/Pass|Selected/i) !== null || iv_verdict.match(/Pass|Selected/i) !== null;
    const is_interview_present = is_interview_cleared || iv_status.match(/Pass|Fail|Attended|Present/i) !== null || iv_verdict.match(/Pass|Fail|Attended|Present/i) !== null;

    const knet_result = (r['Final best Knet Result'] || '').trim();
    const is_knet_passed = is_interview_present || knet_result.match(/Selected|Pass|Cleared/i) !== null;
    const knet_attendance = (r['Final KNET attendance'] || '').trim();
    const is_knet_present = is_knet_passed || knet_result.match(/Selected|Rejected|Fail/i) !== null || knet_attendance === 'Present';

    const is_registered = is_knet_present || amt === 1200 || amt === 600;

    const is_knet = is_knet_present;
    const is_interview = is_interview_cleared;

    funnel.leads++;
    if (is_registered) funnel.registered++;
    if (is_knet_present) funnel.knet++;
    if (is_knet_passed) funnel.knet_passed++;
    if (is_interview_present) funnel.interview_present++;
    if (is_interview_cleared) funnel.interview++;
    if (is_pac) funnel.pac++;
    if (is_paid) funnel.admitted++;

    if (amt === 1200 || amt === 600) {
      let is_organic = false;
      const srcRaw = (r['Lead Source'] || '').trim().toLowerCase();
      if (srcRaw === 'website' || srcRaw.includes('organic') || srcRaw.includes('inbound') || srcRaw.includes('yt') || srcRaw.includes('insta') || srcRaw.includes('social') || srcRaw.includes('blog') || srcRaw.includes('referral') || srcRaw.includes('quora')) {
        is_organic = true;
      }

      const key = `${amt} - ${is_organic ? 'Organic' : 'Non-Organic'}`;
      registrationImpact[key].leads++;
      if (is_paid) registrationImpact[key].admits++;
    }



    const [camp_name, camp_slug] = getCampus(r);
    if (camp_name) {
      const campObj = initDict(byCampus, camp_name, { leads: 0, registered: 0, knet_present: 0, knet_passed: 0, interview_present: 0, interview_cleared: 0, pac: 0, admits: 0 });
      campObj.leads++;
      if (is_registered) campObj.registered++;
      if (is_knet_present) campObj.knet_present++;
      if (is_knet_passed) campObj.knet_passed++;
      if (is_interview_present) campObj.interview_present++;
      if (is_interview_cleared) campObj.interview_cleared++;
      if (is_pac) campObj.pac++;
      if (is_paid) campObj.admits++;

      // Marketing intelligence: use user-captured fields throughout
      const mk = initDict(campusMarketing, camp_name, () => ({ state: {}, source: {}, gender: {}, occ: {}, marks: {}, board: {} }));
      const _state = standardizeState(userField(r, 'state', 'State')) || 'Unknown';
      const _src_raw = (r['Lead Source'] || '').trim(); // BF: CRM only, no user equivalent
      const _srcLower = _src_raw.toLowerCase();
      let _src = _srcLower.includes('fb') || _srcLower.includes('facebook') || _srcLower.includes('meta') ? 'Facebook Ads'
        : _srcLower.includes('google') || _srcLower.includes('gads') ? 'Google Ads'
          : _srcLower.includes('walkin') || _srcLower.includes('walk') ? 'Walk-In'
            : toTitleCase(_src_raw) || 'Unknown';
      const _gender = toTitleCase(userField(r, 'gender', null)) || 'Unknown';         // col I: user
      const _occ = toTitleCase(userField(r, 'parent_occupation', null).replace(/_/g, ' ')) || 'Unknown'; // col T: user
      const _m_raw = parseFloat(userField(r, 'class12_mark', null));                  // col AO: user
      let _marks = 'Unknown';
      if (!isNaN(_m_raw)) { const _m = _m_raw <= 10 ? _m_raw * 9.5 : _m_raw; _marks = _m >= 90 ? '90%+' : _m >= 75 ? '75-90%' : _m >= 60 ? '60-75%' : '<60%'; }
      const _board = userField(r, 'class12_board', 'Board');                          // col AL: user > AW: CRM
      for (const [dim, key] of [['state', _state], ['source', _src], ['gender', _gender], ['occ', _occ], ['marks', _marks], ['board', _board]]) {
        if (key === 'Unknown' || !key) continue;
        initDict(mk[dim], key, { leads: 0, admits: 0 });
        mk[dim][key].leads++;
        if (is_paid) mk[dim][key].admits++;
      }
      // State→Campus and Source→Campus drilldown dicts
      initDict(stateByCampus, _state, {});
      initDict(stateByCampus[_state], camp_name, { leads: 0, knet: 0, interview: 0, pac: 0, admits: 0 });
      stateByCampus[_state][camp_name].leads++;
      if (is_knet) stateByCampus[_state][camp_name].knet++;
      if (is_interview) stateByCampus[_state][camp_name].interview++;
      if (is_pac) stateByCampus[_state][camp_name].pac++;
      if (is_paid) stateByCampus[_state][camp_name].admits++;

      initDict(sourceByCampus, _src, {});
      initDict(sourceByCampus[_src], camp_name, { leads: 0, knet: 0, interview: 0, pac: 0, admits: 0 });
      sourceByCampus[_src][camp_name].leads++;
      if (is_knet) sourceByCampus[_src][camp_name].knet++;
      if (is_interview) sourceByCampus[_src][camp_name].interview++;
      if (is_pac) sourceByCampus[_src][camp_name].pac++;
      if (is_paid) sourceByCampus[_src][camp_name].admits++;
    }

    // === USER-CAPTURED FIELDS (A–AQ = accurate) ===
    // state: AA (user) > BY (CRM fallback)
    const state = standardizeState(userField(r, 'state', 'State')) || 'Unknown';
    const stateObj = initDict(byState, state, { leads: 0, admits: 0 });
    stateObj.leads++;
    if (is_paid) stateObj.admits++;

    const slObj = initDict(stateLeakage, state, { leads: 0, knet: 0, interview: 0, pac: 0, admits: 0 });
    slObj.leads++;
    if (is_knet) slObj.knet++;
    if (is_interview) slObj.interview++;
    if (is_pac) slObj.pac++;
    if (is_paid) slObj.admits++;

    let src = (r['Lead Source'] || '').trim() || 'Unknown';
    const srcLower = src.toLowerCase();
    if (srcLower.includes('fb') || srcLower.includes('facebook') || srcLower.includes('meta')) src = 'Facebook Ads';
    else if (srcLower.includes('google') || srcLower.includes('gads')) src = 'Google Ads';
    else if (srcLower.includes('walkin') || srcLower.includes('walk in') || srcLower.includes('walk-in')) src = 'Walk-In';
    else src = toTitleCase(src);

    const srcObj = initDict(bySource, src, { leads: 0, admits: 0 });
    srcObj.leads++;
    if (is_paid) srcObj.admits++;

    // city: Z (user) — no CRM equivalent needed
    const city = toTitleCase(userField(r, 'city', null)) || 'Unknown';
    const cityObj = initDict(byCity, city, { leads: 0, admits: 0 });
    cityObj.leads++;
    if (is_paid) cityObj.admits++;

    if (is_paid && state !== 'Unknown') {
      const finalSlug = (r['Final slug'] || '').trim();
      const slugNameMap = {
        'srm-ap': 'SRM University AP',
        'amet-kanathur': 'AMET (Kanathur)',
        'yenepoya-university-bangalore': 'Yenepoya Univ - Bangalore',
        'yenepoya-university-mangalore': 'Yenepoya Univ - Mangalore',
        'sju-chennai': 'St. Joseph Univ - Chennai',
        'lpu-punjab': 'Lovely Professional Univ',
        'sgt-university-haryana': 'SGT University',
        'jecrc-jaipur': 'JECRC University',
        'kare-krishnankoil': 'Kalasalingam (KARE)',
        'kalvium-campus': 'Kalvium Campus',
      };
      // Match partial slug
      const matchedName = Object.keys(slugNameMap).find(k => finalSlug.includes(k));
      if (matchedName) {
        const pair = `${state} → ${slugNameMap[matchedName]}`;
        const pairObj = initDict(byPair, pair, { admits: 0 });
        pairObj.admits++;
      }
    }

    // board: AL class12_board (user) > AW Board (CRM fallback)
    let b = userField(r, 'class12_board', 'Board');
    if (!b) b = 'Unknown Board';
    const boardObj = initDict(byBoard, b, { leads: 0, admits: 0 });
    boardObj.leads++;
    if (is_paid) boardObj.admits++;

    // marks: AO class12_mark (user) — prefer user, no class10_mark fallback (CRM could corrupt)
    const mark_str = userField(r, 'class12_mark', null);
    let m = parseFloat(mark_str);
    let b_m = 'Unknown';
    if (!isNaN(m)) {
      if (m <= 10) m = m * 9.5;
      if (m >= 90) b_m = '90%+';
      else if (m >= 75) b_m = '75-90%';
      else if (m >= 60) b_m = '60-75%';
      else b_m = '<60%';
    }
    const markObj = initDict(byMarks, b_m, { leads: 0, admits: 0 });
    markObj.leads++;
    if (is_paid) markObj.admits++;

    // occ: col T parent_occupation (user)
    const occ = toTitleCase(userField(r, 'parent_occupation', null).replace(/_/g, ' ')) || 'Unknown';
    const occObj = initDict(byOccupation, occ, { leads: 0, admits: 0 });
    occObj.leads++;
    if (is_paid) occObj.admits++;

    if (b_m === '90%+') {
      const maObj = initDict(meritAffordability, occ, { leads: 0, admits: 0 });
      maObj.leads++;
      if (is_paid) maObj.admits++;
    }

    // owner: col BM (CRM) — no user equivalent
    const owner = toTitleCase((r['Owner'] || '').trim()) || 'Unassigned';
    const ownerObj = initDict(byOwner, owner, { leads: 0, knet: 0, pac: 0, admits: 0 });
    ownerObj.leads++;
    if (is_knet) ownerObj.knet++;
    if (is_pac) ownerObj.pac++;
    if (is_paid) ownerObj.admits++;

    // academic trajectory: use user-captured marks (AD col10, AO col12)
    const m10 = parseFloat(userField(r, 'class10_mark', null));
    const m12 = parseFloat(userField(r, 'class12_mark', null));
    if (!isNaN(m10) && !isNaN(m12)) {
      let traj = 'Consistent';
      if (m12 > m10 + 5) traj = 'Improved';
      else if (m12 < m10 - 5) traj = 'Dropped';
      academicTrajectory[traj].leads++;
      if (is_paid) academicTrajectory[traj].admits++;
    }

    if (is_knet) {
      const mult = (r['Multiple KNET attendance'] || '').trim().toLowerCase();
      let attempt = (mult === 'yes' || mult === 'true' || parseInt(mult) > 1) ? 'Multiple' : 'Single';
      knetFatigue[attempt].leads++;
      if (is_paid) knetFatigue[attempt].admits++;

      // Velocity Intelligence
      const createDateStr = r['created_at'] || '';
      const knetDateStr = r['Latest KNET Date'] || '';
      const parseDDMMYYYY = (str) => {
        const p = str.split(' ')[0].split('/');
        return p.length === 3 ? new Date(`${p[2]}-${p[1]}-${p[0]}`).getTime() : null;
      };
      const d1 = parseDDMMYYYY(createDateStr);
      const d2 = parseDDMMYYYY(knetDateStr);
      if (d1 && d2) {
        const diffDays = (d2 - d1) / (1000 * 60 * 60 * 24);
        let bucket = '> 30 Days';
        if (diffDays < 7) bucket = '< 7 Days';
        else if (diffDays <= 14) bucket = '7-14 Days';
        else if (diffDays <= 30) bucket = '15-30 Days';
        velocityIntelligence[bucket].leads++;
        if (is_paid) velocityIntelligence[bucket].admits++;
      }
    }

    const numApps = parseInt(r['Number of Application'] || '1') || 1;
    const shopping = numApps > 1 ? 'Multiple' : 'Single';
    crossShopping[shopping].leads++;
    if (is_paid) crossShopping[shopping].admits++;

    // === SALES INTELLIGENCE DATA COLLECTION ===

    // 1. Counsellor × State Affinity
    if (owner !== 'Unassigned' && state !== 'Unknown') {
      initDict(counsellorByState, owner, {});
      initDict(counsellorByState[owner], state, { leads: 0, knet: 0, admits: 0 });
      counsellorByState[owner][state].leads++;
      if (is_knet) counsellorByState[owner][state].knet++;
      if (is_paid) counsellorByState[owner][state].admits++;
    }

    // 2. Pipeline Rescue — passed KNET or Interview but NOT paid
    if ((is_knet_passed || is_interview_cleared) && !is_paid) {
      const fn = r['first_name'] || r['First Name'] || '';
      const ln = r['last_name'] || r['Last Name'] || '';
      const mob = r['mobile_number'] || r['Mobile Number'] || r['Phone Number'] || '';
      const em = r['email'] || r['Email'] || '';
      pipelineRescue.push({
        name: `${fn} ${ln}`.trim(),
        phone: mob, email: em,
        state, board: b, marks: b_m,
        campus: camp_name || 'Unknown',
        stage: is_interview_cleared ? 'Interview Cleared' : is_knet_passed ? 'KNET Passed' : 'KNET Present',
        regFee: amt || 0,
        gender: toTitleCase(userField(r, 'gender', null)) || 'Unknown'
      });
    }

    // 3. Campus Cannibalisation — state × campus full funnel
    if (camp_name && state !== 'Unknown') {
      initDict(campusByState2, state, {});
      initDict(campusByState2[state], camp_name, { leads: 0, registered: 0, knet: 0, admits: 0 });
      campusByState2[state][camp_name].leads++;
      if (is_registered) campusByState2[state][camp_name].registered++;
      if (is_knet) campusByState2[state][camp_name].knet++;
      if (is_paid) campusByState2[state][camp_name].admits++;
    }

    // Campus Profiles
    if (camp_name) {
      let occ_s = occ.replace(/\s+/g, '');

      const gender = toTitleCase((r['gender'] || '').trim()) || 'UnknownGender';
      const ls = (r['Lead Source'] || '').trim() || 'Unknown Source';

      const features = [
        `State:${state}`, `Board:${b}`, `Occ:${occ_s}`,
        `Gender:${gender}`, `Source:${ls}`, `Marks:${b_m}`
      ];

      let dropoff_stage = "";
      if (!is_paid) {
        if (is_pac) dropoff_stage = "Dropped: Post-PAC (No Payment)";
        else if (is_knet) dropoff_stage = "Dropped: Post-KNET (No PAC)";
        else dropoff_stage = "Dropped: Pre-KNET (No Test)";
      }

      const fn = r['first_name'] || r['First Name'] || '';
      const ln = r['last_name'] || r['Last Name'] || '';
      const mob = r['mobile_number'] || r['Mobile Number'] || r['Phone Number'] || '';
      const em = r['email'] || r['Email'] || '';
      const student_info = {
        name: `${fn} ${ln}`.trim(),
        phone: mob,
        email: em,
        is_admitted: is_paid,
        dropoff: dropoff_stage
      };

      // Combination Generator
      const getCombinations = (arr, len) => {
        const combs = [];
        const f = (prefix, arr) => {
          if (prefix.length === len) {
            combs.push(prefix);
            return;
          }
          for (let i = 0; i < arr.length; i++) {
            f([...prefix, arr[i]], arr.slice(i + 1));
          }
        };
        f([], arr);
        return combs;
      };

      initDict(campusProfiles, camp_name, () => ({}));
      const currentCampusProfiles = campusProfiles[camp_name];

      for (let len of [1, 2, 3]) {
        const combos = getCombinations(features, len);
        for (let combo of combos) {
          if (combo.some(c => c.includes('Unknown'))) continue;

          combo.sort();
          const k = combo.join(' + ');

          initDict(currentCampusProfiles, k, { leads: 0, admits: 0, all_students: [] });
          currentCampusProfiles[k].leads++;
          currentCampusProfiles[k].all_students.push(student_info);
          if (is_paid) {
            currentCampusProfiles[k].admits++;
          }
        }
      }
    }
  }

  const getReason = (p, is_golden, campus) => {
    let r = [];
    if (is_golden) {
      if (campus.includes('SRM') && p.includes('Andhra Pradesh')) r.push("Strong home-state affinity.");
      else if (campus.includes('JECRC') && p.includes('Rajasthan')) r.push("Local dominance in Rajasthan.");
      else if (campus.includes('LPU') && p.includes('Punjab')) r.push("Strong brand pull in Punjab.");
      else if (campus.includes('AMET') && p.includes('Tamil Nadu')) r.push("Hyper-local maritime interest.");

      if (p.includes('Business') || p.includes('PrivateSector')) r.push("High liquidity for tier-1 fees.");
      if (p.includes('High-Intent Organic')) r.push("Pre-qualified referral leads convert best.");
      if (p.includes('CBSE')) r.push("English-medium readiness.");

      if (r.length === 0) return `Demographic sweet spot for ${campus}.`;
    } else {
      if (p.includes('March') || p.includes('February')) r.push("Exams distract leads from counselling.");
      if (p.includes('Kerala')) r.push(`Resistant to relocating to ${campus}.`);
      if (p.includes('Tamil Nadu') && campus.includes('SRM')) r.push("TN leads prefer local Anna Univ colleges over out-of-state.");
      if (p.includes('Paid Social Ads')) r.push("Low-intent impulse clicks.");
      if (p.includes('Agriculture')) r.push("Affordability issues.");

      if (r.length === 0) return `Historically zero interest in ${campus} from this cohort.`;
    }
    return r.join(" ");
  };

  const out_campus_profiles = {};

  for (const [camp, profiles] of Object.entries(campusProfiles)) {
    const results = [];
    for (const [k, v] of Object.entries(profiles)) {
      if (v.leads >= 5) {
        const c = conv(v.admits, v.leads);
        results.push({
          profile: k,
          leads: v.leads,
          admits: v.admits,
          conv: c,
          students: v.all_students
        });
      }
    }

    const golden = results.filter(r => r.conv >= 25).sort((a, b) => b.conv - a.conv || b.leads - a.leads);
    const red_flags = results.filter(r => r.conv <= 5).sort((a, b) => a.conv - b.conv || b.leads - a.leads);

    const dedupe = (arr, is_golden) => {
      const seen = new Set();
      const out = [];
      for (const r of arr) {
        if (!seen.has(r.profile)) {
          seen.add(r.profile);
          r.reason = getReason(r.profile, is_golden, camp);
          out.push(r);
        }
      }
      return out;
    };

    const g_out = dedupe(golden, true).slice(0, 10);
    const r_out = dedupe(red_flags, false).slice(0, 10);

    if (g_out.length > 0 || r_out.length > 0) {
      out_campus_profiles[camp] = { goldenProfiles: g_out, redProfiles: r_out };
    }
  }

  // Build Final D Object
  const D = {
    funnel: {
      leads: funnel.leads, registered: funnel.registered,
      knet: funnel.knet, knet_passed: funnel.knet_passed,
      interview_present: funnel.interview_present, interview: funnel.interview,
      pac: funnel.pac, admitted: funnel.admitted,
      registered_pct: conv(funnel.registered, funnel.leads),
      knet_pct: conv(funnel.knet, funnel.registered),
      interview_pct: conv(funnel.interview, funnel.knet),
      pac_pct: conv(funnel.pac, funnel.interview),
      admit_pct: conv(funnel.admitted, funnel.leads)
    },
    byCampus: Object.keys(byCampus).map(k => {
      const c = byCampus[k];
      return {
        name: k,
        leads: c.leads,
        knet_drop: c.leads ? Math.round(((c.leads - c.knet_present) / c.leads) * 100) : 0,
        interview_drop: c.knet_present ? Math.round(((c.knet_present - c.interview_cleared) / c.knet_present) * 100) : 0,
        pac_drop: c.interview_cleared ? Math.round(((c.interview_cleared - c.pac) / c.interview_cleared) * 100) : 0,
        admits: c.admits,
        conv: conv(c.admits, c.leads)
      };
    }).sort((a, b) => b.leads - a.leads),
    byState: Object.keys(byState).filter(k => k !== 'Unknown').map(k => ({ name: k, leads: byState[k].leads, admits: byState[k].admits, conv: conv(byState[k].admits, byState[k].leads) })).sort((a, b) => b.leads - a.leads).slice(0, 15),
    bySource: Object.keys(bySource).filter(k => k !== 'Unknown').map(k => ({ name: k, leads: bySource[k].leads, admits: bySource[k].admits, conv: conv(bySource[k].admits, bySource[k].leads) })).sort((a, b) => b.leads - a.leads).slice(0, 20),
    byCity: Object.keys(byCity).filter(k => k !== 'Unknown' && byCity[k].leads >= 8).map(k => ({ name: k, leads: byCity[k].leads, admits: byCity[k].admits, conv: conv(byCity[k].admits, byCity[k].leads) })).sort((a, b) => b.conv - a.conv).slice(0, 12),
    byPair: Object.keys(byPair).map(k => ({ name: k, admits: byPair[k].admits })).sort((a, b) => b.admits - a.admits).slice(0, 10),
    byBoard: Object.keys(byBoard).filter(k => k !== 'Unknown Board').map(k => ({ name: k, leads: byBoard[k].leads, admits: byBoard[k].admits, conv: conv(byBoard[k].admits, byBoard[k].leads) })).sort((a, b) => b.leads - a.leads),
    byMarks: Object.keys(byMarks).filter(k => k !== 'Unknown').map(k => ({ name: k, leads: byMarks[k].leads, admits: byMarks[k].admits, conv: conv(byMarks[k].admits, byMarks[k].leads) })).sort((a, b) => b.leads - a.leads),
    byOccupation: Object.keys(byOccupation).filter(k => k !== 'Unknown').map(k => ({ name: k, leads: byOccupation[k].leads, admits: byOccupation[k].admits, conv: conv(byOccupation[k].admits, byOccupation[k].leads) })).sort((a, b) => b.leads - a.leads).slice(0, 7),
    byOwner: Object.keys(byOwner).filter(k => k !== 'Unassigned' && byOwner[k].leads >= 50).map(k => ({ name: k, leads: byOwner[k].leads, knet: byOwner[k].knet, pac: byOwner[k].pac, admits: byOwner[k].admits, pac_pct: conv(byOwner[k].pac, byOwner[k].knet), overall_pct: conv(byOwner[k].admits, byOwner[k].leads) })).sort((a, b) => b.admits - a.admits).slice(0, 10),
    academicTrajectory: Object.keys(academicTrajectory).map(k => ({
      traj: k, leads: academicTrajectory[k].leads, admits: academicTrajectory[k].admits, conv: conv(academicTrajectory[k].admits, academicTrajectory[k].leads)
    })),
    knetFatigue: Object.keys(knetFatigue).map(k => ({
      attempt: k, leads: knetFatigue[k].leads, admits: knetFatigue[k].admits, conv: conv(knetFatigue[k].admits, knetFatigue[k].leads)
    })),
    crossShopping: Object.keys(crossShopping).map(k => ({
      shopping: k, leads: crossShopping[k].leads, admits: crossShopping[k].admits, conv: conv(crossShopping[k].admits, crossShopping[k].leads)
    })),
    velocityIntelligence: Object.keys(velocityIntelligence).map(k => ({
      bucket: k, leads: velocityIntelligence[k].leads, admits: velocityIntelligence[k].admits, conv: conv(velocityIntelligence[k].admits, velocityIntelligence[k].leads)
    })),
    registrationImpact: Object.keys(registrationImpact).map(k => ({
      amount: k, leads: registrationImpact[k].leads, admits: registrationImpact[k].admits, conv: conv(registrationImpact[k].admits, registrationImpact[k].leads)
    })),
    stateLeakage: Object.keys(stateLeakage).map(k => ({
      state: k, leads: stateLeakage[k].leads,
      knet_drop: stateLeakage[k].leads ? Math.round(((stateLeakage[k].leads - stateLeakage[k].knet) / stateLeakage[k].leads) * 100) : 0,
      interview_drop: stateLeakage[k].knet ? Math.round(((stateLeakage[k].knet - stateLeakage[k].interview) / stateLeakage[k].knet) * 100) : 0,
      pac_drop: stateLeakage[k].interview ? Math.round(((stateLeakage[k].interview - stateLeakage[k].pac) / stateLeakage[k].interview) * 100) : 0,
      admits: stateLeakage[k].admits,
      overall_conv: conv(stateLeakage[k].admits, stateLeakage[k].leads)
    })).filter(x => x.leads >= 20).sort((a, b) => b.leads - a.leads).slice(0, 8),
    meritAffordability: Object.keys(meritAffordability).map(k => ({
      occupation: k, leads: meritAffordability[k].leads, admits: meritAffordability[k].admits, conv: conv(meritAffordability[k].admits, meritAffordability[k].leads)
    })).filter(x => x.leads >= 5).sort((a, b) => b.conv - a.conv),
    campusProfiles: out_campus_profiles,
    stateByCampus: (() => {
      const out = {};
      for (const [st, camps] of Object.entries(stateByCampus)) {
        if (st === 'Unknown') continue;
        out[st] = Object.keys(camps)
          .map(c => {
            const cc = camps[c];
            return {
              campus: c,
              leads: cc.leads,
              knet_drop: cc.leads ? Math.round(((cc.leads - cc.knet) / cc.leads) * 100) : 0,
              interview_drop: cc.knet ? Math.round(((cc.knet - cc.interview) / cc.knet) * 100) : 0,
              pac_drop: cc.interview ? Math.round(((cc.interview - cc.pac) / cc.interview) * 100) : 0,
              admits: cc.admits,
              conv: conv(cc.admits, cc.leads)
            };
          })
          .sort((a, b) => b.leads - a.leads);
      }
      return out;
    })(),
    sourceByCampus: (() => {
      const out = {};
      for (const [src, camps] of Object.entries(sourceByCampus)) {
        if (src === 'Unknown') continue;
        out[src] = Object.keys(camps)
          .map(c => {
            const cc = camps[c];
            return {
              campus: c,
              leads: cc.leads,
              knet_drop: cc.leads ? Math.round(((cc.leads - cc.knet) / cc.leads) * 100) : 0,
              interview_drop: cc.knet ? Math.round(((cc.knet - cc.interview) / cc.knet) * 100) : 0,
              pac_drop: cc.interview ? Math.round(((cc.interview - cc.pac) / cc.interview) * 100) : 0,
              admits: cc.admits,
              conv: conv(cc.admits, cc.leads)
            };
          })
          .sort((a, b) => b.leads - a.leads);
      }
      return out;
    })(),
    campusPlaybooks: (() => {
      const topN = (dict, n = 5, minLeads = 3) => Object.keys(dict)
        .map(k => ({ name: k, leads: dict[k].leads, admits: dict[k].admits, conv: conv(dict[k].admits, dict[k].leads) }))
        .filter(x => x.leads >= minLeads)
        .sort((a, b) => b.conv - a.conv || b.leads - a.leads)
        .slice(0, n);

      const playbooks = {};
      for (const [camp, mk] of Object.entries(campusMarketing)) {
        const campData = byCampus[camp] || {};
        const totalLeads = campData.leads || 1;
        const totalAdmits = campData.admits || 0;
        const convRate = conv(totalAdmits, totalLeads);

        // Ideal candidate = top converting segments across all dims
        const idealState = topN(mk.state, 3);
        const idealSource = topN(mk.source, 4);
        const idealGender = topN(mk.gender, 2);
        const idealOcc = topN(mk.occ, 3);
        const idealMarks = topN(mk.marks, 3);
        const idealBoard = topN(mk.board, 3);

        // Weakest = lowest converting with enough volume (avoid waste)
        const weakState = Object.keys(mk.state)
          .map(k => ({ name: k, leads: mk.state[k].leads, conv: conv(mk.state[k].admits, mk.state[k].leads) }))
          .filter(x => x.leads >= 5).sort((a, b) => a.conv - b.conv).slice(0, 3);

        const weakSource = Object.keys(mk.source)
          .map(k => ({ name: k, leads: mk.source[k].leads, conv: conv(mk.source[k].admits, mk.source[k].leads) }))
          .filter(x => x.leads >= 5).sort((a, b) => a.conv - b.conv).slice(0, 3);

        playbooks[camp] = {
          campName: camp, totalLeads, totalAdmits, convRate,
          idealState, idealSource, idealGender, idealOcc, idealMarks, idealBoard,
          weakState, weakSource
        };
      }
      return playbooks;
    })(),
    overallPlaybook: (() => {
      const topN = (dict, n, minLeads = 5) => Object.keys(dict)
        .map(k => ({ name: k, leads: dict[k].leads, admits: dict[k].admits, conv: conv(dict[k].admits, dict[k].leads) }))
        .filter(x => x.leads >= minLeads)
        .sort((a, b) => b.conv - a.conv || b.leads - a.leads)
        .slice(0, n);

      const bottomN = (dict, n, minLeads = 10) => Object.keys(dict)
        .map(k => ({ name: k, leads: dict[k].leads, admits: dict[k].admits, conv: conv(dict[k].admits, dict[k].leads) }))
        .filter(x => x.leads >= minLeads)
        .sort((a, b) => a.conv - b.conv || b.leads - a.leads)
        .slice(0, n);

      const avgConv = conv(funnel.admitted, funnel.leads);

      return {
        avgConv,
        totalLeads: funnel.leads,
        totalAdmits: funnel.admitted,
        topStates: topN(byState, 5, 10),
        weakStates: bottomN(byState, 4, 15),
        topSources: topN(bySource, 5, 5),
        weakSources: bottomN(bySource, 4, 10),
        topOcc: topN(byOccupation, 5, 5),
        weakOcc: bottomN(byOccupation, 4, 10),
        topMarks: topN(byMarks, 4, 5),
        topBoard: topN(byBoard, 4, 5),
        weakBoard: bottomN(byBoard, 3, 10),
      };
    })(),

    // ============================================================
    // Segment Combination Intelligence
    // Every 2-way and 3-way combo of: Gender, Board, Marks, State, Occ
    // ============================================================
    // ============================================================
    // ============================================================
    // SALES INTELLIGENCE 1: Counsellor × State Affinity Matrix
    // Which counsellor converts best for which state?
    // ============================================================
    counsellorStateAffinity: (() => {
      const avgConv = conv(funnel.admitted, funnel.leads);
      // Get top counsellors by volume
      const topCounsellors = Object.keys(counsellorByState)
        .filter(o => {
          const total = Object.values(counsellorByState[o]).reduce((s, v) => s + v.leads, 0);
          return total >= 50;
        })
        .sort((a, b) => {
          const aL = Object.values(counsellorByState[a]).reduce((s, v) => s + v.leads, 0);
          const bL = Object.values(counsellorByState[b]).reduce((s, v) => s + v.leads, 0);
          return bL - aL;
        })
        .slice(0, 8);
      // Get top states by volume
      const allStates = {};
      for (const o of topCounsellors) {
        for (const [st, v] of Object.entries(counsellorByState[o])) {
          if (!allStates[st]) allStates[st] = 0;
          allStates[st] += v.leads;
        }
      }
      const topStates = Object.keys(allStates)
        .sort((a, b) => allStates[b] - allStates[a])
        .slice(0, 8);

      return {
        counsellors: topCounsellors,
        states: topStates,
        cell: (owner, state) => {
          const d = counsellorByState[owner] && counsellorByState[owner][state];
          if (!d || d.leads < 5) return null;
          return { leads: d.leads, knet: d.knet, admits: d.admits, conv: conv(d.admits, d.leads) };
        },
        rows: topCounsellors.map(owner => ({
          owner,
          totalLeads: Object.values(counsellorByState[owner]).reduce((s, v) => s + v.leads, 0),
          totalAdmits: Object.values(counsellorByState[owner]).reduce((s, v) => s + v.admits, 0),
          cells: topStates.map(state => {
            const d = counsellorByState[owner] && counsellorByState[owner][state];
            if (!d || d.leads < 5) return null;
            return { leads: d.leads, admits: d.admits, conv: conv(d.admits, d.leads) };
          })
        }))
      };
    })(),

    // ============================================================
    // SALES INTELLIGENCE 2: Pipeline Rescue List
    // Leads stuck in pipeline (KNET passed / Interview cleared but no payment)
    // Grouped by stage × profile → sorted by rescue value
    // ============================================================
    pipelineRescueTable: (() => {
      // Group by stage + campus + marks
      const groups = {};
      for (const lead of pipelineRescue) {
        const key = `${lead.stage}|${lead.campus}|${lead.marks}`;
        if (!groups[key]) groups[key] = { stage: lead.stage, campus: lead.campus, marks: lead.marks, count: 0, highFee: 0, leads: [] };
        groups[key].count++;
        if (lead.regFee >= 1200) groups[key].highFee++;
        groups[key].leads.push(lead);
      }
      // Score: Interview Cleared > KNET Passed, higher marks > lower, ₹1200 payers > ₹600
      const stageWeight = { 'Interview Cleared': 3, 'KNET Passed': 2, 'KNET Present': 1 };
      const marksWeight = { '90%+': 4, '75-90%': 3, '60-75%': 2, '<60%': 1, 'Unknown': 0 };
      return Object.values(groups)
        .map(g => ({
          ...g,
          rescueScore: (stageWeight[g.stage] || 1) * 30 + (marksWeight[g.marks] || 0) * 15 + (g.highFee / Math.max(g.count, 1)) * 20 + Math.min(g.count, 20) * 2
        }))
        .sort((a, b) => b.rescueScore - a.rescueScore)
        .slice(0, 25);
    })(),

    // Total rescue count for headline
    pipelineRescueTotal: pipelineRescue.length,

    // ============================================================
    // SALES INTELLIGENCE 3: Campus Cannibalisation Matrix
    // States where multiple campuses compete — who should own which state?
    // ============================================================
    campusCannibalisation: (() => {
      const rows = [];
      for (const [state, camps] of Object.entries(campusByState2)) {
        const campList = Object.keys(camps).filter(c => camps[c].leads >= 10);
        if (campList.length < 2) continue; // no competition if only 1 campus
        // Find the "winner" and "losers"
        const ranked = campList.map(c => ({
          campus: c,
          leads: camps[c].leads,
          knet: camps[c].knet,
          admits: camps[c].admits,
          conv: conv(camps[c].admits, camps[c].leads),
          knetRate: conv(camps[c].knet, camps[c].leads)
        })).sort((a, b) => b.conv - a.conv);

        const winner = ranked[0];
        const totalLeads = ranked.reduce((s, c) => s + c.leads, 0);
        const totalAdmits = ranked.reduce((s, c) => s + c.admits, 0);
        const wastedLeads = ranked.slice(1).reduce((s, c) => s + c.leads, 0) - ranked.slice(1).reduce((s, c) => s + c.admits, 0);

        rows.push({
          state,
          totalLeads,
          totalAdmits,
          overallConv: conv(totalAdmits, totalLeads),
          campuses: ranked,
          winner: winner.campus,
          winnerConv: winner.conv,
          wastedLeads,
          competitorCount: campList.length
        });
      }
      return rows.sort((a, b) => b.wastedLeads - a.wastedLeads).slice(0, 15);
    })(),

    // MARKETING INTELLIGENCE 1: State Opportunity Matrix
    // For each state: current conversion vs market size → classify
    // as "Scale", "Unlock", "Maintain", or "Pause"
    // ============================================================
    stateOpportunity: (() => {
      const avgConv = conv(funnel.admitted, funnel.leads);
      return Object.keys(byState)
        .filter(k => k !== 'Unknown' && byState[k].leads >= 20)
        .map(k => {
          const s = byState[k];
          const c = conv(s.admits, s.leads);
          const gap = c - avgConv; // above/below average
          // High leads + below avg conv = "Unlock" (big opportunity if fixed)
          // High leads + above avg conv = "Scale" (pour money in)
          // Low leads  + above avg conv = "Expand" (under-penetrated goldmine)
          // Low leads  + below avg conv = "Pause" (not worth it)
          const leadQuartile = s.leads > 200 ? 'High' : 'Low';
          let action, actionColor;
          if (leadQuartile === 'High' && c > avgConv) { action = '🚀 Scale'; actionColor = '#166534'; }
          else if (leadQuartile === 'High' && c <= avgConv) { action = '🔧 Unlock'; actionColor = '#b45309'; }
          else if (leadQuartile === 'Low' && c > avgConv) { action = '📈 Expand'; actionColor = '#1d4ed8'; }
          else { action = '⏸ Pause'; actionColor = '#9ca3af'; }
          return { state: k, leads: s.leads, admits: s.admits, conv: c, avg: avgConv, gap, action, actionColor };
        }).sort((a, b) => b.leads - a.leads);
    })(),

    // ============================================================
    // MARKETING INTELLIGENCE 2: Channel ROI Score
    // For each source: conv%, volume, and composite score + recommended spend action
    // ============================================================
    channelROI: (() => {
      const avgConv = conv(funnel.admitted, funnel.leads);
      return Object.keys(bySource)
        .filter(k => k !== 'Unknown' && bySource[k].leads >= 15)
        .map(k => {
          const s = bySource[k];
          const c = conv(s.admits, s.leads);
          // Composite ROI score: conversion quality × volume weight
          const score = Math.round((c / Math.max(avgConv, 1)) * 60 + (Math.min(s.leads, 500) / 500) * 40);
          let action, actionColor;
          if (c >= avgConv * 1.5 && s.leads >= 50) { action = '✅ Double Budget'; actionColor = '#166534'; }
          else if (c >= avgConv && s.leads >= 30) { action = '🟢 Maintain'; actionColor = '#15803d'; }
          else if (c >= avgConv) { action = '📊 Test More'; actionColor = '#1d4ed8'; }
          else if (c < avgConv * 0.5) { action = '🛑 Pause'; actionColor = '#991b1b'; }
          else { action = '⚠️ Optimise'; actionColor = '#b45309'; }
          return { source: k, leads: s.leads, admits: s.admits, conv: c, score, action, actionColor };
        }).sort((a, b) => b.score - a.score);
    })(),

    // ============================================================
    // MARKETING INTELLIGENCE 3: Board × Marks Conversion Heatmap
    // Cross-tab of board vs marks band — the exact sweet-spot matrix
    // ============================================================
    boardMarksCross: (() => {
      const bands = ['90%+', '75-90%', '60-75%', '<60%'];
      // Get top 6 boards by volume
      const topBoards = Object.keys(byBoard)
        .filter(k => k !== 'Unknown Board' && byBoard[k].leads >= 15)
        .sort((a, b) => byBoard[b].leads - byBoard[a].leads)
        .slice(0, 6);
      // Use segmentCombos data subset
      const cell = {}; // "board|marks" → {leads, admits}
      for (const r of uniqueRows) {
        const board = userField(r, 'class12_board', 'Board') || '';
        if (!topBoards.includes(board)) continue;
        const _m = parseFloat(userField(r, 'class12_mark', null));
        if (isNaN(_m)) continue;
        const m = _m <= 10 ? _m * 9.5 : _m;
        const band = m >= 90 ? '90%+' : m >= 75 ? '75-90%' : m >= 60 ? '60-75%' : '<60%';
        const key = `${board}|${band}`;
        if (!cell[key]) cell[key] = { leads: 0, admits: 0 };
        cell[key].leads++;
        if ((r['1st Year fee payment'] || '').trim() === 'Paid') cell[key].admits++;
      }
      return {
        boards: topBoards,
        bands,
        cell: (board, band) => {
          const d = cell[`${board}|${band}`];
          if (!d || d.leads < 5) return null;
          return { leads: d.leads, admits: d.admits, conv: conv(d.admits, d.leads) };
        },
        // Flatten for serialization
        rows: topBoards.map(board => ({
          board,
          cells: bands.map(band => {
            const d = cell[`${board}|${band}`];
            if (!d || d.leads < 5) return null;
            return { leads: d.leads, admits: d.admits, conv: conv(d.admits, d.leads) };
          })
        }))
      };
    })(),

    segmentCombos: (() => {
      const seg = {};
      const convFn = (a, b) => b ? Math.round((a / b) * 100) : 0;

      const addSeg = (key, paid, student_info) => {
        if (!seg[key]) seg[key] = { leads: 0, admits: 0, students: [] };
        seg[key].leads++;
        if (paid) seg[key].admits++;
        seg[key].students.push(student_info);
      };

      const combos2 = (arr) => {
        const out = [];
        for (let i = 0; i < arr.length; i++)
          for (let j = i + 1; j < arr.length; j++)
            out.push([arr[i], arr[j]]);
        return out;
      };
      const combos3 = (arr) => {
        const out = [];
        for (let i = 0; i < arr.length; i++)
          for (let j = i + 1; j < arr.length; j++)
            for (let k = j + 1; k < arr.length; k++)
              out.push([arr[i], arr[j], arr[k]]);
        return out;
      };
      const combos4 = (arr) => {
        const out = [];
        for (let i = 0; i < arr.length; i++)
          for (let j = i + 1; j < arr.length; j++)
            for (let k = j + 1; k < arr.length; k++)
              for (let l = k + 1; l < arr.length; l++)
                out.push([arr[i], arr[j], arr[k], arr[l]]);
        return out;
      };
      const combos5 = (arr) => {
        const out = [];
        for (let i = 0; i < arr.length; i++)
          for (let j = i + 1; j < arr.length; j++)
            for (let k = j + 1; k < arr.length; k++)
              for (let l = k + 1; l < arr.length; l++)
                for (let m = l + 1; m < arr.length; m++)
                  out.push([arr[i], arr[j], arr[k], arr[l], arr[m]]);
        return out;
      };

      for (const r of uniqueRows) {
        if ((r['Lead Source'] || '').trim() === 'SRM.AP_Univ_2026') continue;
        const paid = (r['1st Year fee payment'] || '').trim() === 'Paid';

        // standard funnel logic to get paid, knet, pac, interview, etc.
        const amt = parseInt(r['amount']);
        const is_paid = paid;
        const is_pac = is_paid || (r['PAC'] || '').trim() === 'PAC Completed';
        const iv_status = (r['Knet Interview all status'] || '').trim();
        const iv_verdict = (r['Knet Interview verdict'] || '').trim();
        const is_interview_cleared = is_pac || iv_status.match(/Pass|Selected/i) !== null || iv_verdict.match(/Pass|Selected/i) !== null;
        const is_interview_rejected = iv_status.match(/Fail|Rejected/i) !== null || iv_verdict.match(/Fail|Rejected/i) !== null;
        const is_interview_present = is_interview_cleared || is_interview_rejected || iv_status.match(/Attended|Present/i) !== null || iv_verdict.match(/Attended|Present/i) !== null;

        const knet_result = (r['Final best Knet Result'] || '').trim();
        const is_knet_passed = is_interview_cleared || knet_result.match(/Selected|Pass|Cleared/i) !== null;
        const knet_attendance = (r['Final KNET attendance'] || '').trim();
        const is_knet_present = is_knet_passed || knet_result.match(/Selected|Rejected|Fail/i) !== null || knet_attendance === 'Present';
        const is_knet = is_knet_present;
        const is_knet_rejected = knet_result.match(/Rejected|Fail/i) !== null;
        
        let dropoff_stage = "";
        if (!is_paid) {
          if (is_pac) dropoff_stage = "Dropped: Post-PAC (No Payment)";
          else if (is_interview_rejected) dropoff_stage = "Rejected (Failed Interview)";
          else if (is_interview_present) dropoff_stage = "Dropped: Post-Interview (No PAC)";
          else if (is_knet_passed) dropoff_stage = "Did not attend Interview";
          else if (is_knet_rejected) dropoff_stage = "Rejected (Failed KNET)";
          else if (is_knet) dropoff_stage = "Dropped: Post-KNET (No Interview)";
          else dropoff_stage = "Did not give KNET";
        }

        const [camp_name] = getCampus(r);
        const fn = r['first_name'] || r['First Name'] || '';
        const ln = r['last_name'] || r['Last Name'] || '';
        const mob = r['mobile_number'] || r['Mobile Number'] || r['Phone Number'] || '';
        const em = r['email'] || r['Email'] || '';
        const lang = (r['Language'] || '').trim();

        const cs = (r['campus_slug'] || '').trim();
        const fs = (r['Final slug'] || '').trim();
        const valid_fs = (fs && !['-', '#N/A', 'None', 'Unknown'].includes(fs)) ? fs : null;

        const [applied_campus] = resolveCampusName(cs);
        const [final_campus] = valid_fs ? resolveCampusName(valid_fs) : [null];
        const changed_uni = is_paid && final_campus && applied_campus && final_campus !== applied_campus;

        const student_info = {
          name: `${fn} ${ln}`.trim(),
          phone: mob,
          email: em,
          is_admitted: is_paid,
          dropoff: dropoff_stage,
          campus: applied_campus || camp_name || 'Unknown',
          language: lang || 'Unknown',
          knet_attendance: knet_attendance || '-',
          knet_result: knet_result || '-',
          iv_status: iv_status || '-',
          iv_verdict: iv_verdict || '-',
          final_campus: is_paid ? (final_campus || applied_campus || camp_name) : null,
          changed_uni: changed_uni
        };

        const _state = standardizeState(userField(r, 'state', 'State')) || null;
        const _gender = toTitleCase((r['gender'] || '').trim()) || null;
        const _board = userField(r, 'class12_board', 'Board') || null;
        const _m_raw = parseFloat(userField(r, 'class12_mark', null));
        let _marks = null;
        if (!isNaN(_m_raw)) {
          const _m = _m_raw <= 10 ? _m_raw * 9.5 : _m_raw;
          _marks = _m >= 90 ? '90%+' : _m >= 75 ? '75-90%' : _m >= 60 ? '60-75%' : '<60%';
        }
        const _occ = toTitleCase((r['parent_occupation'] || '').trim().replace(/_/g, ' ')) || null;

        const attrs = [];
        if (_gender && _gender !== 'Unknown') attrs.push(['Gender', _gender]);
        if (_board && _board !== 'Unknown') attrs.push(['Board', _board]);
        if (_marks) attrs.push(['Marks', _marks]);
        if (_state && _state !== 'Unknown') attrs.push(['State', _state]);
        if (_occ && _occ !== 'Unknown') attrs.push(['Occ', _occ]);
        if (lang && lang !== 'Unknown') attrs.push(['Lang', lang]);

        for (const combo of combos2(attrs)) {
          const key = combo.map(([k, v]) => `${k}=${v}`).sort().join(' | ');
          addSeg(key, paid, student_info);
        }
        for (const combo of combos3(attrs)) {
          const key = combo.map(([k, v]) => `${k}=${v}`).sort().join(' | ');
          addSeg(key, paid, student_info);
        }
        for (const combo of combos4(attrs)) {
          const key = combo.map(([k, v]) => `${k}=${v}`).sort().join(' | ');
          addSeg(key, paid, student_info);
        }
        for (const combo of combos5(attrs)) {
          const key = combo.map(([k, v]) => `${k}=${v}`).sort().join(' | ');
          addSeg(key, paid, student_info);
        }
      }

      const allCombos = Object.entries(seg)
        .filter(([, d]) => d.leads >= 10)
        .map(([key, d]) => ({
          key,
          tags: key.split(' | ').map(s => { const [k, v] = s.split('='); return { k, v }; }),
          leads: d.leads, admits: d.admits,
          conv: convFn(d.admits, d.leads),
          students: d.students
        }));

      const golden = allCombos.filter(x => x.conv >= 25).sort((a, b) => b.conv - a.conv || b.leads - a.leads).slice(0, 100);
      const waste = allCombos.filter(x => x.conv <= 5 && x.leads >= 10).sort((a, b) => a.conv - b.conv || b.leads - a.leads).slice(0, 50);

      return { golden, waste, all: allCombos.sort((a, b) => b.conv - a.conv) };
    })()
  };

  D.languages = [...new Set(uniqueRows.map(r => (r['Language'] || '').trim()).filter(Boolean))].sort();

  return D;
}
