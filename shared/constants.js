/* ═══════════════════════════════════════════════════════════════
   ANANTAM PIT DISPLAY — SHARED CONSTANTS
   Single source of truth for both Control and Display apps.
   ═══════════════════════════════════════════════════════════════ */

export const STATES = {
    HOME:               'HOME',
    AI:                 'AI',
    PORTFOLIOS:         'PORTFOLIOS',
    PORTFOLIO_VIEW:     'PORTFOLIO_VIEW',
    WEBSITES:           'WEBSITES',
    WEBSITES_SUBBRANDS: 'WEBSITES_SUBBRANDS',
    WEBSITE_VIEW:       'WEBSITE_VIEW',
    INSTAGRAM:          'INSTAGRAM',
    ANIMATION:          'ANIMATION',
    CAR_INTRO:          'CAR_INTRO',
    CAR_IDLE:           'CAR_IDLE',
    CAR_CONTROL:        'CAR_CONTROL',
    CAR_EXPLODED:       'CAR_EXPLODED',
    CAR_AR:             'CAR_AR',
};

/* Car sub-states for easy grouping */
export const CAR_STATES = [
    STATES.CAR_INTRO,
    STATES.CAR_IDLE,
    STATES.CAR_CONTROL,
    STATES.CAR_EXPLODED,
    STATES.CAR_AR,
];

export function isCarState(state) {
    return CAR_STATES.includes(state);
}

export const EVENTS = {
    /* State synchronization */
    STATE_CHANGE:   'state:change',
    STATE_SYNC:     'state:sync',

    /* AI App control events (Control <-> Display) */
    AI_PTT_TOGGLE:        'ai:ptt-toggle',
    AI_STATE_SYNC:        'ai:state-sync',
    AI_ERROR:             'ai:error',
    AI_RECOVER:           'ai:recover',
    AI_REFRESH:           'ai:refresh',
    AI_RECOVERY_COMPLETE: 'ai:recovery-complete',

    /* Scroll / navigation commands from Control → Display */
    SCROLL_CMD:     'scroll:cmd',
    VIDEO_CMD:      'video:cmd',
    PDF_CMD:        'pdf:cmd',
    PDF_STATE:      'pdf:state',
    CAR_CMD:        'car:cmd',
    WEBSITE_CMD:    'website:cmd',
    PORTFOLIO_CMD:  'portfolio:cmd',
    TRACKPAD_CMD:   'trackpad:cmd',
    BACK_CMD:       'back:cmd',

    /* Remote cursor events (Control → Display) */
    CURSOR_MOVE:    'cursor:move',
    CURSOR_CLICK:   'cursor:click',
    CURSOR_SCROLL:  'cursor:scroll',
    CURSOR_ZOOM:    'cursor:zoom',

    /* Audio configuration */
    AUDIO_CMD:      'audio:cmd',

    /* Interaction heartbeat (resets inactivity) */
    INTERACTION:    'interaction',
};

/* Audio command payloads */
export const AUDIO = {
    MUTE:   'MUTE',
    UNMUTE: 'UNMUTE',
};

/* Scroll command payloads */
export const SCROLL = {
    UP:   'SCROLL_UP',
    DOWN: 'SCROLL_DOWN',
};

/* Video command payloads */
export const VIDEO = {
    PLAY:    'PLAY',
    PAUSE:   'PAUSE',
    RESTART: 'RESTART',
    SKIP_FWD:'SKIP_FWD',
    SKIP_BWD:'SKIP_BWD',
};

/* PDF command payloads */
export const PDF = {
    NEXT:     'NEXT',
    PREV:     'PREV',
};

/* Car control payloads (from touchscreen) */
export const CAR_CMD = {
    ROTATE_LEFT:  'ROTATE_LEFT',
    ROTATE_RIGHT: 'ROTATE_RIGHT',
    ZOOM_IN:      'ZOOM_IN',
    ZOOM_OUT:     'ZOOM_OUT',
    RESET:        'RESET',
};

/* Gesture events (local to Display, not sent over socket) */
export const GESTURE = {
    PINCH_START: 'PINCH_START',
    PINCH_END:   'PINCH_END',
    ROTATE:      'ROTATE',
    ZOOM_IN:     'ZOOM_IN',
    ZOOM_OUT:    'ZOOM_OUT',
    RESET_VIEW:  'RESET_VIEW',
};

/* Portfolio categories */
export const PORTFOLIOS = {
    DESIGN:     { id: 'design',     label: 'DESIGN & ENGINEERING', url: '/mock/portfolio_design.html' },
    MANAGEMENT: { id: 'management', label: 'PROJECT MANAGEMENT',   url: '/mock/portfolio_management.html' },
    ENTERPRISE: { id: 'enterprise', label: 'ENTERPRISE',           url: '/mock/portfolio_enterprise.html' },
};


/* Configuration */
export const CONFIG = {
    SERVER_PORT:           3000,
    INACTIVITY_TIMEOUT_MS: 90000,  // 90 seconds
    RESET_TRANSITION_MS:   2000,   // system-reset animation before returning to HOME
    TURNTABLE_SPEED:       0.003,  // radians per frame
};

/* ═══════════════════════════════════════════════════════════════
   ANANTAM AI — CONSTANTS
   Voice-first AI intelligence experience.
   ═══════════════════════════════════════════════════════════════ */

/* AI Interaction States */
export const AI_STATES = {
    IDLE:                'AI_IDLE',
    LISTENING:           'AI_LISTENING',
    TRANSCRIBING:        'AI_TRANSCRIBING',
    SEARCHING_KNOWLEDGE: 'AI_SEARCHING_KNOWLEDGE',
    THINKING:            'AI_THINKING',
    RESPONDING:          'AI_RESPONDING',
    SPEAKING:            'AI_SPEAKING',
    INTERRUPTED:         'AI_INTERRUPTED',
    ERROR:               'AI_ERROR',
    RECOVERING:          'AI_RECOVERING',
};

/* AI Socket.IO Events */
export const AI_EVENTS = {
    AUDIO_CHUNK:        'ai:audio-chunk',
    TRANSCRIPT_INTERIM: 'ai:transcript-interim',
    TRANSCRIPT_FINAL:   'ai:transcript-final',
    RESPONSE_TEXT:      'ai:response-text',
    RESPONSE_AUDIO:     'ai:response-audio',
    RESPONSE_DONE:      'ai:response-done',
    STATE_CHANGE:       'ai:state-change',
    STATUS:             'ai:status',
    ERROR:              'ai:error',
    SESSION_START:      'ai:session-start',
    SESSION_END:        'ai:session-end',
    INTERRUPT:          'ai:interrupt',
};

/* AI Provider Modes */
export const AI_MODES = {
    CLOUD_GEMINI:    'CLOUD_GEMINI',
    CLOUD_OPENAI:    'CLOUD_OPENAI',
    LOCAL:           'LOCAL',
    OFFLINE:         'OFFLINE',
};
