const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATABASE_PATH =
  process.env.DATABASE_PATH || path.join(ROOT, 'data', 'kangxujia.db');
const SEED_PATH = path.join(ROOT, 'data', 'seed-data.json');

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

const db = new DatabaseSync(DATABASE_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_account (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    real_name TEXT NOT NULL,
    phone TEXT,
    organization TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS patient_profile (
    patient_id TEXT PRIMARY KEY,
    patient_code TEXT NOT NULL UNIQUE,
    alias TEXT NOT NULL,
    gender TEXT,
    age INTEGER,
    diagnosis TEXT,
    discharge_date TEXT,
    rehab_stage TEXT,
    main_problem TEXT,
    risk_level TEXT,
    family_support TEXT,
    status TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS patient_binding (
    binding_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patient_profile(patient_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    UNIQUE(patient_id, user_id, relation_type)
  );

  CREATE TABLE IF NOT EXISTS rehab_assessment (
    assessment_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patient_profile(patient_id) ON DELETE CASCADE,
    assessment_date TEXT NOT NULL,
    upper_limb REAL,
    lower_limb REAL,
    balance REAL,
    gait REAL,
    adl REAL,
    pain REAL,
    fatigue REAL,
    fall_risk TEXT,
    swallowing TEXT,
    speech TEXT,
    cognition TEXT,
    assessor TEXT REFERENCES user_account(user_id),
    comment TEXT
  );

  CREATE TABLE IF NOT EXISTS training_plan (
    plan_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patient_profile(patient_id) ON DELETE CASCADE,
    plan_name TEXT NOT NULL,
    training_goal TEXT,
    frequency TEXT,
    duration TEXT,
    need_family_assist TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS training_action (
    action_id TEXT PRIMARY KEY,
    plan_id TEXT REFERENCES training_plan(plan_id) ON DELETE CASCADE,
    action_name TEXT NOT NULL,
    category TEXT,
    difficulty TEXT,
    reps TEXT,
    sets INTEGER,
    safety_note TEXT,
    ai_enabled INTEGER NOT NULL DEFAULT 0,
    action_code TEXT UNIQUE,
    instruction TEXT,
    voice_feedback TEXT,
    description TEXT,
    duration TEXT
  );

  CREATE TABLE IF NOT EXISTS action_recognition_rule (
    rule_id TEXT PRIMARY KEY,
    action_id TEXT NOT NULL REFERENCES training_action(action_id) ON DELETE CASCADE,
    rule_code TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    operator TEXT NOT NULL,
    threshold REAL NOT NULL,
    unit TEXT NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    UNIQUE(action_id, rule_code)
  );

  CREATE TABLE IF NOT EXISTS daily_training_log (
    log_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patient_profile(patient_id) ON DELETE CASCADE,
    action_id TEXT REFERENCES training_action(action_id) ON DELETE SET NULL,
    log_date TEXT NOT NULL,
    completed INTEGER NOT NULL,
    duration_min REAL,
    pain REAL,
    fatigue REAL,
    dizzy INTEGER,
    patient_feedback TEXT,
    caregiver_feedback TEXT,
    submitter TEXT REFERENCES user_account(user_id)
  );

  CREATE TABLE IF NOT EXISTS risk_alert (
    alert_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patient_profile(patient_id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL,
    alert_level TEXT NOT NULL,
    trigger_reason TEXT,
    suggestion TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    handler TEXT REFERENCES user_account(user_id),
    handled_at TEXT
  );

  CREATE TABLE IF NOT EXISTS followup_record (
    followup_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patient_profile(patient_id) ON DELETE CASCADE,
    followup_date TEXT NOT NULL,
    method TEXT,
    adherence_summary TEXT,
    function_change TEXT,
    current_problem TEXT,
    adjustment_suggestion TEXT,
    revisit_needed INTEGER,
    revisit_reason TEXT,
    next_date TEXT,
    followup_doctor TEXT REFERENCES user_account(user_id)
  );

  CREATE TABLE IF NOT EXISTS stage_report (
    report_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patient_profile(patient_id) ON DELETE CASCADE,
    report_period TEXT NOT NULL,
    completion_rate REAL,
    alert_count INTEGER,
    followup_count INTEGER,
    rehab_trend TEXT,
    therapist_opinion TEXT,
    report_status TEXT
  );

  CREATE TABLE IF NOT EXISTS ai_vision_session (
    vision_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL REFERENCES patient_profile(patient_id) ON DELETE CASCADE,
    action_id TEXT REFERENCES training_action(action_id) ON DELETE SET NULL,
    session_time TEXT NOT NULL,
    source TEXT,
    smoothness_score REAL,
    jerk_peak REAL,
    jerk_variance REAL,
    reach_angle REAL,
    projection_shortening REAL,
    compensated_amplitude REAL,
    compensation_confidence REAL,
    pruning_mode TEXT,
    risk_level TEXT,
    system_suggestion TEXT,
    duration_sec REAL,
    frame_count INTEGER,
    target_label TEXT,
    abnormal_warning TEXT,
    tracked_points_json TEXT,
    rule_events_json TEXT,
    action_metrics_json TEXT
  );

  CREATE TABLE IF NOT EXISTS ai_runtime_metric (
    metric_id TEXT PRIMARY KEY,
    vision_id TEXT NOT NULL REFERENCES ai_vision_session(vision_id) ON DELETE CASCADE,
    retained_keypoints INTEGER,
    pruning_ratio REAL,
    avg_fps REAL,
    latency_ms REAL,
    device_load TEXT,
    low_confidence_count INTEGER,
    warning_triggered INTEGER
  );

  CREATE TABLE IF NOT EXISTS patient_vision_calibration (
    patient_id TEXT PRIMARY KEY REFERENCES patient_profile(patient_id) ON DELETE CASCADE,
    calibration_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_meta (
    meta_key TEXT PRIMARY KEY,
    meta_value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_assessment_patient_date
    ON rehab_assessment(patient_id, assessment_date DESC);
  CREATE INDEX IF NOT EXISTS idx_log_patient_date
    ON daily_training_log(patient_id, log_date DESC);
  CREATE INDEX IF NOT EXISTS idx_alert_patient_created
    ON risk_alert(patient_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_vision_patient_time
    ON ai_vision_session(patient_id, session_time DESC);
`);

const visionColumns = db.prepare('PRAGMA table_info(ai_vision_session)').all();
if (!visionColumns.some((column) => column.name === 'action_metrics_json')) {
  db.exec('ALTER TABLE ai_vision_session ADD COLUMN action_metrics_json TEXT');
}

function asBool(value) {
  return value === true || value === 1 || value === '1' || value === '是';
}

function statusToDb(value) {
  return ({ pending: '待处理', resolved: '已处理', ignored: '已忽略' })[value] || value || '待处理';
}

function statusFromDb(value) {
  return ({ 待处理: 'pending', 已处理: 'resolved', 已忽略: 'ignored' })[value] || value || 'pending';
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [algorithm, salt, expected] = String(stored || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return (
    actual.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actual, expectedBuffer)
  );
}

function stableId(prefix, ...parts) {
  const hash = crypto
    .createHash('sha1')
    .update(parts.map((part) => String(part ?? '')).join('|'))
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return `${prefix}${hash}`;
}

function runTransaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function insertObject(table, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map((column) => `@${column}`).join(', ');
  const updates = columns
    .filter((column) => !column.endsWith('_id'))
    .map((column) => `${column}=excluded.${column}`)
    .join(', ');
  const sql = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT DO UPDATE SET ${updates || `${columns[0]}=${columns[0]}`}
  `;
  db.prepare(sql).run(row);
}

function seedDatabase() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM user_account').get().count;
  if (count > 0) return;

  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  runTransaction(() => {
    for (const row of seed.user_account) {
      insertObject('user_account', {
        user_id: row.user_id,
        username: row.username,
        password_hash: hashPassword(row.password),
        role: row.role,
        real_name: row.real_name,
        phone: row.phone,
        organization: row.organization,
      });
    }

    const directTables = [
      'patient_profile',
      'patient_binding',
      'rehab_assessment',
      'training_plan',
      'training_action',
      'daily_training_log',
      'risk_alert',
      'followup_record',
      'stage_report',
      'ai_vision_session',
      'ai_runtime_metric',
    ];

    for (const table of directTables) {
      for (const source of seed[table] || []) {
        const row = { ...source };
        if (table === 'training_plan') row.active = asBool(row.active) ? 1 : 0;
        if (table === 'training_action') row.ai_enabled = asBool(row.ai_enabled) ? 1 : 0;
        if (table === 'daily_training_log') {
          row.completed = asBool(row.completed) ? 1 : 0;
          row.dizzy = asBool(row.dizzy) ? 1 : 0;
        }
        if (table === 'followup_record') row.revisit_needed = asBool(row.revisit_needed) ? 1 : 0;
        if (table === 'ai_runtime_metric') row.warning_triggered = asBool(row.warning_triggered) ? 1 : 0;
        insertObject(table, row);
      }
    }

    for (const action of seed.visual_action_definition || []) {
      const { rules, ...actionRow } = action;
      insertObject('training_action', {
        ...actionRow,
        plan_id: null,
        ai_enabled: asBool(actionRow.ai_enabled) ? 1 : 0,
        description: actionRow.instruction,
        duration: '10分钟',
      });
      for (const rule of rules) {
        insertObject('action_recognition_rule', {
          rule_id: `${action.action_id}-${rule.rule_code}`,
          action_id: action.action_id,
          ...rule,
        });
      }
    }

    insertObject('system_meta', {
      meta_key: 'seed_source',
      meta_value: '康续家_数据库模拟数据包_第一层业务闭环与第二层AI视觉.xlsx',
    });
    insertObject('system_meta', {
      meta_key: 'seeded_at',
      meta_value: new Date().toISOString(),
    });
  });
}

function syncVisualActionDefinitions() {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  runTransaction(() => {
    for (const action of seed.visual_action_definition || []) {
      const { rules, ...actionRow } = action;
      insertObject('training_action', {
        ...actionRow,
        plan_id: null,
        ai_enabled: 1,
        description: actionRow.instruction,
        duration: '10分钟',
      });
      for (const rule of rules) {
        insertObject('action_recognition_rule', {
          rule_id: `${action.action_id}-${rule.rule_code}`,
          action_id: action.action_id,
          ...rule,
        });
      }
    }
  });
}

function resetDatabase() {
  db.exec(`
    DELETE FROM ai_runtime_metric;
    DELETE FROM ai_vision_session;
    DELETE FROM patient_vision_calibration;
    DELETE FROM stage_report;
    DELETE FROM followup_record;
    DELETE FROM risk_alert;
    DELETE FROM daily_training_log;
    DELETE FROM action_recognition_rule;
    DELETE FROM training_action;
    DELETE FROM training_plan;
    DELETE FROM rehab_assessment;
    DELETE FROM patient_binding;
    DELETE FROM patient_profile;
    DELETE FROM user_account;
    DELETE FROM system_meta;
  `);
  seedDatabase();
}

function authenticate(username, password) {
  const user = db
    .prepare('SELECT * FROM user_account WHERE username = ?')
    .get(username);
  if (!user || !verifyPassword(password, user.password_hash)) return null;

  const binding = db
    .prepare(`
      SELECT patient_id
      FROM patient_binding
      WHERE user_id = ?
      ORDER BY CASE relation_type
        WHEN '患者本人' THEN 1
        WHEN '家属' THEN 2
        ELSE 3
      END
      LIMIT 1
    `)
    .get(user.user_id);

  return {
    userId: user.user_id,
    username: user.username,
    role: user.role,
    name: user.real_name,
    label:
      ({ admin: '管理员', therapist: '治疗师', patient: '患者', caregiver: '家属', judge: '评委查看' })[
        user.role
      ] || user.role,
    boundPatientId: binding?.patient_id || null,
  };
}

function rowsByPatient(table, orderBy = '') {
  const rows = db.prepare(`SELECT * FROM ${table} ${orderBy}`).all();
  return rows.reduce((map, row) => {
    (map[row.patient_id] ||= []).push(row);
    return map;
  }, {});
}

function getPatients() {
  const profiles = db.prepare('SELECT * FROM patient_profile ORDER BY patient_id').all();
  const assessments = rowsByPatient(
    'rehab_assessment',
    'ORDER BY patient_id, assessment_date DESC',
  );
  const plans = rowsByPatient('training_plan', 'ORDER BY patient_id, plan_id');
  const logs = rowsByPatient(
    'daily_training_log',
    'ORDER BY patient_id, log_date',
  );
  const alerts = rowsByPatient(
    'risk_alert',
    'ORDER BY patient_id, created_at',
  );
  const followups = rowsByPatient(
    'followup_record',
    'ORDER BY patient_id, followup_date',
  );
  const reports = rowsByPatient(
    'stage_report',
    'ORDER BY patient_id, report_period',
  );
  const sessions = rowsByPatient(
    'ai_vision_session',
    'ORDER BY patient_id, session_time',
  );
  const actions = db.prepare('SELECT * FROM training_action ORDER BY action_id').all();
  const rules = db
    .prepare('SELECT * FROM action_recognition_rule ORDER BY action_id, rule_id')
    .all();
  const runtime = db.prepare('SELECT * FROM ai_runtime_metric').all();
  const users = db.prepare('SELECT user_id, real_name FROM user_account').all();
  const calibrations = db.prepare('SELECT * FROM patient_vision_calibration').all();

  const userNames = Object.fromEntries(users.map((row) => [row.user_id, row.real_name]));
  const actionMap = Object.fromEntries(actions.map((row) => [row.action_id, row]));
  const runtimeMap = Object.fromEntries(runtime.map((row) => [row.vision_id, row]));
  const calibrationMap = Object.fromEntries(
    calibrations.map((row) => [row.patient_id, JSON.parse(row.calibration_json)]),
  );
  const rulesByAction = rules.reduce((map, row) => {
    (map[row.action_id] ||= []).push({
      code: row.rule_code,
      metric: row.metric_name,
      operator: row.operator,
      threshold: row.threshold,
      unit: row.unit,
      severity: row.severity,
      message: row.message,
    });
    return map;
  }, {});

  return profiles.map((profile) => {
    const assessment = assessments[profile.patient_id]?.[0] || {};
    const patientPlans = (plans[profile.patient_id] || []).map((plan) => ({
      id: plan.plan_id,
      name: plan.plan_name,
      target: plan.training_goal,
      frequency: plan.frequency,
      duration: plan.duration,
      familyAssist: plan.need_family_assist,
      active: Boolean(plan.active),
      createdAt: plan.created_at?.slice(0, 10),
      actions: actions
        .filter((action) => action.plan_id === plan.plan_id)
        .map((action) => ({
          id: action.action_id,
          name: action.action_name,
          category: action.category,
          description: action.description || action.instruction || action.safety_note,
          reps: action.reps,
          sets: action.sets,
          duration: action.duration || '10分钟',
          difficulty: action.difficulty,
          assist: /是|建议/.test(plan.need_family_assist || ''),
          safety: action.safety_note,
          aiEnabled: Boolean(action.ai_enabled),
          actionCode: action.action_code,
          instruction: action.instruction,
          voiceFeedback: action.voice_feedback,
          recognitionRules: rulesByAction[action.action_id] || [],
        })),
    }));

    const patientSessions = (sessions[profile.patient_id] || []).map((session) => {
      const metric = runtimeMap[session.vision_id] || {};
      return {
        id: session.vision_id,
        date: session.session_time?.slice(0, 10),
        sessionTime: session.session_time,
        source: session.source === '真实采集' ? 'camera' : 'demo',
        actionId: session.action_id,
        action: actionMap[session.action_id]?.action_name || '视觉训练',
        smoothnessScore: session.smoothness_score,
        jerkPeak: session.jerk_peak,
        jerkVariance: session.jerk_variance,
        riskLevel: session.risk_level,
        estimatedReachAngle: session.reach_angle,
        projectionShortening: session.projection_shortening || 0,
        compensatedAmplitude: session.compensated_amplitude || session.reach_angle || 0,
        compensationConfidence: session.compensation_confidence,
        recognitionMode: session.pruning_mode,
        trackedPoints: JSON.parse(session.tracked_points_json || '[]'),
        retainedKeypoints: metric.retained_keypoints || 10,
        pruningRatio: metric.pruning_ratio || 70,
        avgFps: metric.avg_fps || 0,
        latency: metric.latency_ms || 0,
        deviceLoad: metric.device_load || '未知',
        duration: session.duration_sec || 0,
        frameCount: session.frame_count || 0,
        targetLabel: session.target_label || '',
        abnormalWarning: session.abnormal_warning || '',
        ruleEvents: JSON.parse(session.rule_events_json || '[]'),
        actionMetrics: JSON.parse(session.action_metrics_json || '[]'),
        suggestion: session.system_suggestion,
      };
    });

    const completionValues = (reports[profile.patient_id] || []).map(
      (report) => Number(report.completion_rate) || 0,
    );
    const latestReport = (reports[profile.patient_id] || []).at(-1);

    return {
      id: profile.patient_id,
      code: profile.patient_code,
      alias: profile.alias,
      name: profile.alias,
      gender: profile.gender,
      age: profile.age,
      diagnosis: profile.diagnosis,
      discharge: profile.discharge_date,
      stage: profile.rehab_stage,
      rehabStage: profile.rehab_stage,
      fallRisk: assessment.fall_risk || profile.risk_level?.replace('风险', ''),
      familySupport: profile.family_support,
      risk: profile.risk_level,
      status: profile.status,
      disease: profile.main_problem,
      adl: assessment.adl || 0,
      score: Math.round(
        [assessment.upper_limb, assessment.lower_limb, assessment.balance, assessment.gait]
          .filter((value) => value !== null && value !== undefined)
          .reduce((sum, value, _, values) => sum + Number(value) / values.length, 0),
      ),
      compliance: completionValues.length
        ? Math.round(completionValues.reduce((sum, value) => sum + value, 0) / completionValues.length)
        : 0,
      assessment: {
        id: assessment.assessment_id,
        date: assessment.assessment_date,
        upperLimb: assessment.upper_limb ?? 0,
        lowerLimb: assessment.lower_limb ?? 0,
        balance: assessment.balance ?? 0,
        gait: assessment.gait ?? 0,
        adl: assessment.adl ?? 0,
        pain: assessment.pain ?? 0,
        fatigue: assessment.fatigue ?? 0,
        fallRisk: assessment.fall_risk || '中',
        swallowing: assessment.swallowing || '正常',
        speech: assessment.speech || '正常',
        cognition: assessment.cognition || '基本正常',
        rehabStage: profile.rehab_stage,
        comment: assessment.comment || profile.main_problem,
        assessorId: assessment.assessor,
      },
      recommendation: {
        direction: patientPlans.find((plan) => plan.active)?.target || latestReport?.therapist_opinion || '',
        frequency: patientPlans.find((plan) => plan.active)?.frequency || '',
        duration: patientPlans.find((plan) => plan.active)?.duration || '',
        familyAssist: patientPlans.find((plan) => plan.active)?.familyAssist || '',
      },
      plans: patientPlans,
      logs: (logs[profile.patient_id] || []).map((log) => ({
        id: log.log_id,
        actionId: log.action_id,
        date: log.log_date,
        done: Boolean(log.completed),
        duration: log.duration_min,
        pain: log.pain,
        fatigue: log.fatigue,
        dizzy: Boolean(log.dizzy),
        note: log.patient_feedback,
        caregiverFeedback: log.caregiver_feedback,
        submitter: log.submitter,
      })),
      followups: (followups[profile.patient_id] || []).map((followup) => ({
        id: followup.followup_id,
        date: followup.followup_date,
        method: followup.method,
        adherence: followup.adherence_summary,
        functionChange: followup.function_change,
        problem: followup.current_problem,
        suggestion: followup.adjustment_suggestion,
        revisit: Boolean(followup.revisit_needed),
        revisitReason: followup.revisit_reason || '',
        nextDate: followup.next_date || '',
        authorId: followup.followup_doctor,
        author: userNames[followup.followup_doctor] || followup.followup_doctor || '',
      })),
      alerts: (alerts[profile.patient_id] || []).map((alert) => ({
        id: alert.alert_id,
        patientId: profile.patient_id,
        type: alert.alert_type,
        level: alert.alert_level,
        reason: alert.trigger_reason,
        suggestion: alert.suggestion,
        status: statusFromDb(alert.status),
        createdAt: alert.created_at,
        handlerId: alert.handler,
        handler: userNames[alert.handler] || '',
        handledAt: alert.handled_at || '',
      })),
      stageReports: reports[profile.patient_id] || [],
      vision: {
        calibration:
          calibrationMap[profile.patient_id] || {
            upperArmBaseline: 132,
            forearmBaseline: 118,
            cameraPosition: '正前方或斜前方，接近肩部高度',
          },
        summary:
          '数据库已保存训练处方、视觉会话、运行指标和动作代偿规则。',
        sessions: patientSessions,
      },
    };
  });
}

function getVisualActions() {
  const actions = db
    .prepare(`
      SELECT *
      FROM training_action
      WHERE action_code IS NOT NULL AND action_code <> ''
      ORDER BY action_id
    `)
    .all();
  const rules = db
    .prepare(`
      SELECT *
      FROM action_recognition_rule
      ORDER BY action_id, rule_id
    `)
    .all();
  return actions.map((action) => ({
    id: action.action_id,
    name: action.action_name,
    category: action.category,
    description: action.description,
    reps: action.reps,
    sets: action.sets,
    duration: action.duration,
    difficulty: action.difficulty,
    safety: action.safety_note,
    aiEnabled: true,
    actionCode: action.action_code,
    instruction: action.instruction,
    voiceFeedback: action.voice_feedback,
    recognitionRules: rules
      .filter((rule) => rule.action_id === action.action_id)
      .map((rule) => ({
        code: rule.rule_code,
        metric: rule.metric_name,
        operator: rule.operator,
        threshold: rule.threshold,
        unit: rule.unit,
        severity: rule.severity,
        message: rule.message,
      })),
  }));
}

function savePatients(patients, updatedAt = new Date().toISOString()) {
  runTransaction(() => {
    db.exec(`
      DELETE FROM ai_runtime_metric;
      DELETE FROM ai_vision_session;
      DELETE FROM stage_report;
      DELETE FROM followup_record;
      DELETE FROM risk_alert;
      DELETE FROM daily_training_log;
      DELETE FROM action_recognition_rule;
      DELETE FROM training_action;
      DELETE FROM training_plan;
      DELETE FROM rehab_assessment;
      DELETE FROM patient_vision_calibration;
    `);

    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    for (const action of seed.visual_action_definition || []) {
      const { rules, ...actionRow } = action;
      insertObject('training_action', {
        ...actionRow,
        plan_id: null,
        ai_enabled: 1,
        description: actionRow.instruction,
        duration: '10分钟',
      });
      for (const rule of rules) {
        insertObject('action_recognition_rule', {
          rule_id: `${action.action_id}-${rule.rule_code}`,
          action_id: action.action_id,
          ...rule,
        });
      }
    }

    for (const patient of patients) {
      insertObject('patient_profile', {
        patient_id: patient.id,
        patient_code: patient.code || `CASE-${patient.id}`,
        alias: patient.alias || patient.name || patient.id,
        gender: patient.gender || '',
        age: Number(patient.age) || null,
        diagnosis: patient.diagnosis || '',
        discharge_date: patient.discharge || '',
        rehab_stage: patient.rehabStage || patient.stage || '',
        main_problem: patient.disease || '',
        risk_level: patient.risk || '中风险',
        family_support: patient.familySupport || '中协同',
        status: patient.status || '训练中',
        updated_at: updatedAt,
      });

      const assessment = patient.assessment || {};
      insertObject('rehab_assessment', {
        assessment_id:
          assessment.id || stableId('AS', patient.id, assessment.date || updatedAt),
        patient_id: patient.id,
        assessment_date: assessment.date || updatedAt.slice(0, 10),
        upper_limb: assessment.upperLimb ?? 0,
        lower_limb: assessment.lowerLimb ?? 0,
        balance: assessment.balance ?? 0,
        gait: assessment.gait ?? 0,
        adl: assessment.adl ?? patient.adl ?? 0,
        pain: assessment.pain ?? 0,
        fatigue: assessment.fatigue ?? 0,
        fall_risk: assessment.fallRisk || patient.fallRisk || '中',
        swallowing: assessment.swallowing || '正常',
        speech: assessment.speech || '正常',
        cognition: assessment.cognition || '基本正常',
        assessor: assessment.assessorId || null,
        comment: assessment.comment || '',
      });

      for (const plan of patient.plans || []) {
        insertObject('training_plan', {
          plan_id: plan.id,
          patient_id: patient.id,
          plan_name: plan.name,
          training_goal: plan.target || '',
          frequency: plan.frequency || patient.recommendation?.frequency || '',
          duration: plan.duration || patient.recommendation?.duration || '',
          need_family_assist:
            plan.familyAssist ||
            patient.recommendation?.familyAssist ||
            (plan.actions?.some((action) => action.assist) ? '是' : '否'),
          active: plan.active ? 1 : 0,
          created_at: plan.createdAt || updatedAt,
        });

        for (const action of plan.actions || []) {
          insertObject('training_action', {
            action_id: action.id,
            plan_id: plan.id,
            action_name: action.name,
            category: action.category || '',
            difficulty: action.difficulty || '中',
            reps: action.reps || '',
            sets: Number(action.sets) || 1,
            safety_note: action.safety || '',
            ai_enabled: action.aiEnabled || action.actionCode ? 1 : 0,
            action_code: action.actionCode || null,
            instruction: action.instruction || '',
            voice_feedback: action.voiceFeedback || '',
            description: action.description || '',
            duration: action.duration || '',
          });
          for (const rule of action.recognitionRules || []) {
            insertObject('action_recognition_rule', {
              rule_id: `${action.id}-${rule.code}`,
              action_id: action.id,
              rule_code: rule.code,
              metric_name: rule.metric,
              operator: rule.operator,
              threshold: Number(rule.threshold),
              unit: rule.unit,
              severity: rule.severity,
              message: rule.message,
            });
          }
        }
      }

      for (const [index, log] of (patient.logs || []).entries()) {
        insertObject('daily_training_log', {
          log_id: log.id || stableId('DL', patient.id, log.date, index, log.note),
          patient_id: patient.id,
          action_id: log.actionId || null,
          log_date: log.date,
          completed: log.done ? 1 : 0,
          duration_min: Number(log.duration) || null,
          pain: Number(log.pain) || 0,
          fatigue: Number(log.fatigue) || 0,
          dizzy: log.dizzy ? 1 : 0,
          patient_feedback: log.note || '',
          caregiver_feedback: log.caregiverFeedback || '',
          submitter: log.submitter || null,
        });
      }

      for (const alert of patient.alerts || []) {
        insertObject('risk_alert', {
          alert_id: alert.id,
          patient_id: patient.id,
          alert_type: alert.type,
          alert_level: alert.level,
          trigger_reason: alert.reason || '',
          suggestion: alert.suggestion || '',
          status: statusToDb(alert.status),
          created_at: alert.createdAt || updatedAt,
          handler: alert.handlerId || null,
          handled_at: alert.handledAt || null,
        });
      }

      for (const [index, followup] of (patient.followups || []).entries()) {
        insertObject('followup_record', {
          followup_id:
            followup.id || stableId('FU', patient.id, followup.date, index),
          patient_id: patient.id,
          followup_date: followup.date,
          method: followup.method || '',
          adherence_summary: followup.adherence || '',
          function_change: followup.functionChange || '',
          current_problem: followup.problem || '',
          adjustment_suggestion: followup.suggestion || '',
          revisit_needed: followup.revisit ? 1 : 0,
          revisit_reason: followup.revisitReason || '',
          next_date: followup.nextDate || '',
          followup_doctor: followup.authorId || null,
        });
      }

      for (const [index, report] of (patient.stageReports || []).entries()) {
        insertObject('stage_report', {
          report_id:
            report.report_id || report.id || stableId('SR', patient.id, index),
          patient_id: patient.id,
          report_period: report.report_period || report.period || '',
          completion_rate: Number(report.completion_rate ?? patient.compliance) || 0,
          alert_count: Number(report.alert_count ?? patient.alerts?.length) || 0,
          followup_count:
            Number(report.followup_count ?? patient.followups?.length) || 0,
          rehab_trend: report.rehab_trend || '',
          therapist_opinion: report.therapist_opinion || '',
          report_status: report.report_status || '已生成',
        });
      }

      for (const [index, session] of (patient.vision?.sessions || []).entries()) {
        const visionId =
          session.id ||
          stableId(
            'VS',
            patient.id,
            session.sessionTime || session.date,
            session.actionId || session.action,
            index,
          );
        insertObject('ai_vision_session', {
          vision_id: visionId,
          patient_id: patient.id,
          action_id:
            session.actionId ||
            (patient.plans || [])
              .flatMap((plan) => plan.actions || [])
              .find((action) => action.name === session.action)?.id ||
            null,
          session_time:
            session.sessionTime ||
            `${session.date || updatedAt.slice(0, 10)} ${new Date().toTimeString().slice(0, 8)}`,
          source: session.source === 'camera' ? '真实采集' : '演示样本',
          smoothness_score: Number(session.smoothnessScore) || 0,
          jerk_peak: Number(session.jerkPeak) || 0,
          jerk_variance: Number(session.jerkVariance) || 0,
          reach_angle: Number(session.estimatedReachAngle) || 0,
          projection_shortening: Number(session.projectionShortening) || 0,
          compensated_amplitude: Number(session.compensatedAmplitude) || 0,
          compensation_confidence: Number(session.compensationConfidence) || 0,
          pruning_mode: session.recognitionMode || '上肢模式',
          risk_level: session.riskLevel || '低风险',
          system_suggestion: session.suggestion || '',
          duration_sec: Number(session.duration) || 0,
          frame_count: Number(session.frameCount) || 0,
          target_label: session.targetLabel || '',
          abnormal_warning: session.abnormalWarning || '',
          tracked_points_json: JSON.stringify(session.trackedPoints || []),
          rule_events_json: JSON.stringify(session.ruleEvents || []),
          action_metrics_json: JSON.stringify(session.actionMetrics || []),
        });
        insertObject('ai_runtime_metric', {
          metric_id: session.metricId || stableId('VM', visionId),
          vision_id: visionId,
          retained_keypoints: Number(session.retainedKeypoints) || 10,
          pruning_ratio: Number(session.pruningRatio) || 70,
          avg_fps: Number(session.avgFps) || 0,
          latency_ms: Number(session.latency) || 0,
          device_load: session.deviceLoad || '未知',
          low_confidence_count: Number(session.lowConfidenceCount) || 0,
          warning_triggered:
            session.abnormalWarning || session.ruleEvents?.length ? 1 : 0,
        });
      }

      insertObject('patient_vision_calibration', {
        patient_id: patient.id,
        calibration_json: JSON.stringify(patient.vision?.calibration || {}),
        updated_at: updatedAt,
      });
    }

    insertObject('system_meta', {
      meta_key: 'last_patient_sync',
      meta_value: updatedAt,
    });
  });
}

function getDatabaseSummary() {
  const tables = [
    'user_account',
    'patient_profile',
    'patient_binding',
    'rehab_assessment',
    'training_plan',
    'training_action',
    'action_recognition_rule',
    'daily_training_log',
    'risk_alert',
    'followup_record',
    'stage_report',
    'ai_vision_session',
    'ai_runtime_metric',
  ];
  return {
    databasePath: DATABASE_PATH,
    tables: Object.fromEntries(
      tables.map((table) => [
        table,
        db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      ]),
    ),
    seedSource:
      db
        .prepare("SELECT meta_value FROM system_meta WHERE meta_key = 'seed_source'")
        .get()?.meta_value || null,
    lastPatientSync:
      db
        .prepare("SELECT meta_value FROM system_meta WHERE meta_key = 'last_patient_sync'")
        .get()?.meta_value || null,
  };
}

seedDatabase();
syncVisualActionDefinitions();

module.exports = {
  authenticate,
  db,
  getDatabaseSummary,
  getPatients,
  getVisualActions,
  resetDatabase,
  savePatients,
};
