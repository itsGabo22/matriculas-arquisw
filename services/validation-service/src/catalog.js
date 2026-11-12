// Datos curriculares en memoria (en producción: plan de estudios versionado por semestre).
// Este contexto es dueño del lenguaje: prerrequisito, correquisito, crédito, promedio, franja horaria.

const sections = {
  'ARQSW-01': {
    courseId: 'ARQSW', name: 'Arquitectura de Software', credits: 3,
    prerequisites: ['INGSW2'], corequisites: [],
    schedule: [{ day: 'LUN', start: 8, end: 10 }, { day: 'MIE', start: 8, end: 10 }],
  },
  'LABRED-01': {
    courseId: 'LABRED', name: 'Laboratorio de Redes', credits: 1,
    prerequisites: [], corequisites: ['REDES'],
    schedule: [{ day: 'VIE', start: 14, end: 16 }],
  },
};

// Perfil por defecto: estudiante regular elegible (permite pruebas de carga con IDs arbitrarios).
const defaultStudent = {
  gpa: 4.0, approvedCourses: ['INGSW1', 'INGSW2'], enrolledCredits: 12,
  enrolledCourses: [], schedule: [{ day: 'MAR', start: 10, end: 12 }],
};

// Perfiles explícitos para demostrar cada regla de la cadena.
const students = {
  'est-sin-prerreq': { ...defaultStudent, approvedCourses: ['INGSW1'] },
  'est-prueba-acad': { ...defaultStudent, gpa: 2.8, enrolledCredits: 11 },
  'est-choque': { ...defaultStudent, schedule: [{ day: 'LUN', start: 9, end: 11 }] },
};

const getStudent = (id) => students[id] || defaultStudent;
const getSection = (id) => sections[id];

module.exports = { getStudent, getSection };
