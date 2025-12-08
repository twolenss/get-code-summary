

import { Component, OnInit, HostListener } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { ChangeDetectorRef } from '@angular/core';
import { ApiService } from '../../../../api.service';
import { GlobalService } from '../../../../global.service';
import { MatDialog } from '@angular/material';
import { map } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { MatSelectModule, MatFormFieldModule, MatInputModule, MatIconModule } from '@angular/material';
import { ChangeDetectionStrategy } from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
interface Exam {
  code: string;
  version: string;
  subjectId: string;
  title: string;
  course: string;
  yearLevel: number;
  lec: number;
  lab: number;
  oe: number;
  dept: string;
  deptCode: string;
  instructor: string;
  instructorClassificationStatus?: string;
  DESCRIPTIVE_TITLE?: string;
  room?: string; // ✅ ADD THIS - stores the original room from ERP
}

interface ScheduledExam {
  CODE: string;
  SUBJECT_ID: string;
  DESCRIPTIVE_TITLE: string;
  COURSE: string;
  YEAR_LEVEL: number;
  INSTRUCTOR: string;
  DEPT: string;
  DEPT_SUB: string;
  OE: number;
  DAY: string;
  SLOT: string;
  ROOM: string;
  PROCTOR?: string; // NEW: Proctor field
  HAS_CONFLICT?: boolean; // NEW: Conflict indicator
  IS_MULTI_SLOT?: boolean;
  SLOT_INDEX?: number;
  TOTAL_SLOTS?: number;
  durationHours?: number;
}

interface ProctorAssignment {
  examCode: string;
  originalInstructor: string;
  assignedProctor: string;
  hasConflict: boolean;
  availableSubstitutes: string[];
}

interface ToastMessage {
  title: string;
  description: string;
  variant?: string;
}

interface SafeSlotOption {
  day: string;
  slot: string;
  availableRooms: string[];
}

interface YearSlots {
  year: number;
  slots: { [slot: string]: ScheduledExam[] };
}

interface CourseGrid {
  course: string;
  years: YearSlots[];
}

interface Year {
  year: number;
  slots: { [slot: string]: Exam[] };
}

interface Course {
  course: string;
  years: Year[];
}



@Component({
  selector: 'app-scheduler',
  templateUrl: './scheduler.component.html',
  styleUrls: ['./scheduler.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush  // ADD THIS

})
export class SchedulerComponent implements OnInit {
  currentStep: 'import' | 'generate' | 'summary' | 'timetable' | 'coursegrid' | 'proctor' = 'import';
  SLOT_HOUR = 1.5; 
  rawCodes: any[] = [];
  exams: Exam[] = [];
   UnenrolledExam: Exam[] = [];
  rooms: string[] = [];
  generatedSchedule: ScheduledExam[] = [];
  examDates: string[] = [''];
  
  numberOfDays: number = 3;
  
  editingRow: number | null = null;
  editedExam: ScheduledExam | null = null;
  
  availableSlots: string[] = [];
  availableRooms: string[] = [];
  
  activeTerm: string = '';
  combinedOptions: { label: string, value: string }[] = [];
  termOptions = [
    { key: 1, value: '1st Term' },
    { key: 2, value: '2nd Term' },
    { key: 3, value: 'Summer' },
  ];
  
  isLoadingApi: boolean = false;
  
  timeSlots: string[] = [
    '7:30-9:00',
    '9:00-10:30',
    '10:30-12:00',
    '12:00-1:30',
    '1:30-3:00',
    '3:00-4:30',
    '4:30-6:00',
    '6:00-7:30'
  ];
  
  days: string[] = ['Day 1', 'Day 2', 'Day 3'];
  activeDay: string = 'Day 1';
  toast: ToastMessage | null = null;
  
  searchQuery: string = '';
  selectedCourseFilter: string = '';
  selectedYearFilter: number | null = null;
  availableYearsForCourse: number[] = [];
  selectedDeptFilter: string = ''; // NEW: Department filter

    // Generated schedule cascading filters
  selectedGeneratedDept: string = '';
  selectedGeneratedCourse: string = '';
  selectedGeneratedYear: number | null = null;
  availableGeneratedCourses: string[] = [];
  availableGeneratedYears: number[] = [];
  
  courseSummary: any[] = [];
  roomTimeData: any = { table: {}, rooms: [], days: [] };
  courseGridData: any = { grid: {}, courses: [], days: [] };
// Key: "DAY_SLOT" => Set of rooms used in that timeslot
usedRoomsPerSlot: { [key: string]: Set<string> } = {};

  // movePopupVisible = false;
  // moveExamData: any = null;
  // safeSlots: SafeSlotOption[] = [];
movePopupVisible: boolean = false;
moveExamData: any = null; // holds the selected exam to move
safeSlots: Array<{day: string, slot: string}> = [];
 unscheduledExams: Exam[] = [];
  showUnscheduledPanel: boolean = false;
  // NEW: Proctor assignment properties
  proctorAssignments: Map<string, ProctorAssignment> = new Map();
  conflictingExams: ScheduledExam[] = [];
  availableProctors: Map<string, string[]> = new Map(); // examCode -> available proctors
  // Map instructor name -> array of occupied slots {day, time}
instructorSchedule: Record<string, { day: string; slot: string }[]> = {};
 proctorSearchQuery: string = ''; // <-- add this

// showUnscheduledPanel: boolean = false;
editingUnscheduledExam: Exam | null = null;
editFormData: any = null;
 
editingUnscheduledIndex: number | null = null;
manualScheduleData: { day: string; slot: string; room: string } | null = null;

// Add these properties to your component class
private proctorSuggestionsCache = new Map<string, any>();
private filteredListCache: ScheduledExam[] = [];
private lastFilterState = { query: '', dept: '', subject: '' };

// Proctor filtering
selectedProctorDept: string = '';
selectedSubjectDept: string = '';
selectedProctorSubject: string = '';
showProctorSuggestions: boolean = true;

// Enhanced proctor data structures
instructorSubjects: Map<string, Set<string>> = new Map(); // instructor -> subjects they teach
instructorDepartments: Map<string, string> = new Map(); // instructor -> their department

  selectedExamForProctor: ScheduledExam | null = null;

editingExamKey: string | null = null; // Store UNIQUE identifier instead of index


// Add these properties to your component class
private proctorSuggestionsMap = new Map<string, any>();
private allProctorsMap = new Map<string, string[]>();
private _filteredProctorList: ScheduledExam[] = [];
private processingCancelled = false;

// Conflict detection
conflictDetails: {
  proctorConflicts: Array<{
    proctor: string;
    day: string;
    slot: string;
    exams: ScheduledExam[];
  }>;
  roomConflicts: Array<{
    room: string;
    day: string;
    slot: string;
    exams: ScheduledExam[];
  }>;
} = {
  proctorConflicts: [],
  roomConflicts: []
};

showConflictPanel: boolean = false;


  constructor(
    public api: ApiService, 
    public global: GlobalService, 
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private http: HttpClient, 
    private cd: ChangeDetectorRef
  ) {}

  // NEW: Auto-save on browser unload
  @HostListener('window:beforeunload', ['$event'])
  unloadHandler(event: any) {
    this.autoSaveToLocalStorage();
  }

  isEmptyCell(day: string, course: string, slot: string, year: number): boolean {
    if (!this.courseGridData || !this.courseGridData.grid) return true;
    if (!this.courseGridData.grid[day]) return true;
    if (!this.courseGridData.grid[day][course]) return true;

    const cell = this.courseGridData.grid[day][course][slot];
    if (!cell || cell.length === 0) return true;

    return !cell.some(e => e.yearLevel === year);
  }

  ngOnInit() {
    this.updateDaysArray();
    this.activeDay = this.days[0];
    this.roomTimeData.days = [...this.days];
    this.courseGridData.days = [...this.days];
    this.courseGridData.courses = [];
    
    this.combineYearTerm();
    console.log('uniqueCourseDepartments:', this.uniqueCourseDepartments);
  console.log('uniqueInstructorDepartments:', this.uniqueInstructorDepartments);
  
    if (this.hasSavedData()) {
      this.showRestorePrompt();
    }
    
    // Auto-save every 30 seconds
    setInterval(() => {
      if (this.generatedSchedule.length > 0) {
        this.autoSaveToLocalStorage();
      }
    }, 30000);
  }

  updateDaysArray() {
    this.days = [];
    for (let i = 1; i <= this.numberOfDays; i++) {
      this.days.push(`Day ${i}`);
    }
    
    this.examDates = new Array(this.numberOfDays).fill('');
    
    this.activeDay = this.days[0];
    this.roomTimeData.days = [...this.days];
    this.courseGridData.days = [...this.days];
  }

  onNumberOfDaysChange() {
    if (this.numberOfDays < 1) this.numberOfDays = 1;
    if (this.numberOfDays > 5) this.numberOfDays = 5;
    
    this.updateDaysArray();
  }

get filteredSchedule(): ScheduledExam[] {
  let filtered = [...this.generatedSchedule];
  
  // Apply search query
  if (this.searchQuery.trim()) {
    const query = this.searchQuery.toLowerCase();
    filtered = filtered.filter(exam => 
      exam.CODE.toLowerCase().includes(query) ||
      exam.SUBJECT_ID.toLowerCase().includes(query) ||
      exam.DESCRIPTIVE_TITLE.toLowerCase().includes(query) ||
      exam.INSTRUCTOR.toLowerCase().includes(query) ||
      (exam.PROCTOR && exam.PROCTOR.toLowerCase().includes(query))
    );
  }
  
  // Apply department filter
  if (this.selectedGeneratedDept) {
    filtered = filtered.filter(exam => 
      exam.DEPT_SUB.toUpperCase() === this.selectedGeneratedDept.toUpperCase()
    );
  }
  
  // Apply course filter
  if (this.selectedGeneratedCourse) {
    filtered = filtered.filter(exam => 
      exam.COURSE.toUpperCase().trim() === this.selectedGeneratedCourse.toUpperCase().trim()
    );
  }
  
  // Apply year filter
  if (this.selectedGeneratedYear !== null) {
    filtered = filtered.filter(exam => 
      exam.YEAR_LEVEL === this.selectedGeneratedYear
    );
  }
  
  return filtered;
}

  get filteredCourseSummary(): any[] {
    let filtered = [...this.courseSummary];
    
    if (this.selectedCourseFilter) {
      filtered = filtered.filter(c => c.course === this.selectedCourseFilter);
      
      if (this.selectedYearFilter !== null) {
        filtered = filtered.map(c => ({
          ...c,
          yearLevelGroups: c.yearLevelGroups.filter((yg: any) => yg.yearLevel === this.selectedYearFilter)
        })).filter((c: any) => c.yearLevelGroups.length > 0);
      }
    }
    
    // NEW: Department filter
    if (this.selectedDeptFilter) {
      filtered = filtered.map(c => ({
        ...c,
        yearLevelGroups: c.yearLevelGroups.map((yg: any) => ({
          ...yg,
          groups: yg.groups.map((g: any) => ({
            ...g,
            exams: g.exams.filter((e: any) => 
              e.DEPT.toUpperCase() === this.selectedDeptFilter.toUpperCase()
            )
          })).filter((g: any) => g.exams.length > 0)
        })).filter((yg: any) => yg.groups.length > 0)
      })).filter((c: any) => c.yearLevelGroups.length > 0);
    }
    
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.map(c => ({
        ...c,
        yearLevelGroups: c.yearLevelGroups.map((yg: any) => ({
          ...yg,
          groups: yg.groups.map((g: any) => ({
            ...g,
            exams: g.exams.filter((e: any) => 
              e.SUBJECT_ID.toLowerCase().includes(query) ||
              e.DESCRIPTIVE_TITLE.toLowerCase().includes(query) ||
              e.CODE.toLowerCase().includes(query) ||
              e.INSTRUCTOR.toLowerCase().includes(query)
            )
          })).filter((g: any) => g.exams.length > 0)
        })).filter((yg: any) => yg.groups.length > 0)
      })).filter((c: any) => c.yearLevelGroups.length > 0);
    }
    
    return filtered;
  }

 get filteredCourseGrid(): CourseGrid[] {
  if (!this.courseGridData || !this.courseGridData.grid || !this.activeDay) return [];

  const dayGrid = this.courseGridData.grid[this.activeDay] || {};

  // ✅ FIX: Filter courses based on selectedCourseFilter
  let coursesToShow = this.courseGridData.courses;
  
  if (this.selectedCourseFilter) {
    coursesToShow = coursesToShow.filter(course => 
      course === this.selectedCourseFilter
    );
  }

  return coursesToShow.map(course => {
    const existingYears = new Set<number>();
    
    this.timeSlots.forEach(slot => {
      const exams = dayGrid[course] && dayGrid[course][slot] ? dayGrid[course][slot] : [];
      exams.forEach((exam: any) => {
        existingYears.add(exam.yearLevel);
      });
    });

    const years: YearSlots[] = Array.from(existingYears).sort((a, b) => a - b).map(year => {
      const slots: { [slot: string]: ScheduledExam[] } = {};

      this.timeSlots.forEach(slot => {
        const exams: ScheduledExam[] =
          dayGrid[course] && dayGrid[course][slot] ? dayGrid[course][slot] : [];

        slots[slot] = exams.filter(exam => {
          const query = this.searchQuery ? this.searchQuery.toLowerCase() : '';
          const matchesSearch =
            !query ||
            exam.CODE.toLowerCase().includes(query) ||
            exam.SUBJECT_ID.toLowerCase().includes(query) ||
            exam.DESCRIPTIVE_TITLE.toLowerCase().includes(query) ||
            exam.INSTRUCTOR.toLowerCase().includes(query);

          const matchesYear = !this.selectedYearFilter || exam.YEAR_LEVEL === this.selectedYearFilter;
          const matchesRowYear = exam.YEAR_LEVEL === year;
          
          // ✅ ADD: Department filter (optional, if you want it in Course Grid)
          const matchesDept = !this.selectedDeptFilter || 
            (exam.DEPT && exam.DEPT.toUpperCase() === this.selectedDeptFilter.toUpperCase());

          return matchesSearch && matchesYear && matchesRowYear && matchesDept;
        });
      });

      return { year, slots };
    });

    return { course, years };
  });
}


   get filteredCourseGridNonEmpty(): CourseGrid[] {
  // ✅ Apply course filter first
  let baseFiltered = this.filteredCourseGrid;
  
  if (this.selectedCourseFilter) {
    baseFiltered = baseFiltered.filter(c => c.course === this.selectedCourseFilter);
  }
  
  return baseFiltered
    .map(c => ({
      ...c,
      years: c.years
        .map(y => {
          const typedSlots: { [slot: string]: ScheduledExam[] } = y.slots;
          const filteredSlots: { [slot: string]: ScheduledExam[] } = {};

          Object.entries(typedSlots).forEach(([slot, exams]) => {
            const safeExams: ScheduledExam[] = exams || [];
            filteredSlots[slot] = safeExams.filter(exam => {
              const query = this.searchQuery ? this.searchQuery.toLowerCase() : '';
              const matchesSearch =
                !query ||
                exam.CODE.toLowerCase().includes(query) ||
                exam.SUBJECT_ID.toLowerCase().includes(query) ||
                exam.DESCRIPTIVE_TITLE.toLowerCase().includes(query) ||
                exam.INSTRUCTOR.toLowerCase().includes(query);

              const matchesYear = !this.selectedYearFilter || exam.YEAR_LEVEL === this.selectedYearFilter;
              const matchesRowYear = exam.YEAR_LEVEL === y.year;
              
              // ✅ ADD: Department filter
              const matchesDept = !this.selectedDeptFilter || 
                (exam.DEPT && exam.DEPT.toUpperCase() === this.selectedDeptFilter.toUpperCase());

              return matchesSearch && matchesYear && matchesRowYear && matchesDept;
            });
          });

          return { ...y, slots: filteredSlots };
        })
        .filter(y => Object.values(y.slots).some(exs => exs.length > 0))
    }))
    .filter(c => c.years.length > 0);
}

  get uniqueCourses(): string[] {
    return Array.from(new Set(this.generatedSchedule.map(e => e.COURSE))).sort();
  }

  // NEW: Get unique departments
  get uniqueDepartments(): string[] {
    return Array.from(new Set(this.generatedSchedule.map(e => e.DEPT))).filter(d => d).sort();
  }

   get uniqueCourseDepartments(): string[] {
    return Array.from(new Set(this.generatedSchedule.map(e => e.DEPT_SUB))).filter(d => d).sort();
  }

  onCourseFilterChange() {
    if (this.selectedCourseFilter) {
      const yearsSet = new Set(
        this.generatedSchedule
          .filter(e => e.COURSE === this.selectedCourseFilter)
          .map(e => e.YEAR_LEVEL)
      );
      this.availableYearsForCourse = Array.from(yearsSet).sort();
    } else {
      this.availableYearsForCourse = [];
      this.selectedYearFilter = null;
    }
  }

  clearFilters() {
    this.searchQuery = '';
    this.selectedCourseFilter = '';
    this.selectedYearFilter = null;
    this.selectedDeptFilter = '';
    this.availableYearsForCourse = [];
  }

  combineYearTerm() {
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 1; y <= currentYear + 1; y++) {
      const nextYear = y + 1;
      for (const t of this.termOptions) {
        const label = `${t.value} ${y}-${nextYear}`;
        const value = `${y}${nextYear.toString().slice(-2)}${t.key}`;
        this.combinedOptions.push({ label, value });
      }
    }
  }
// ============================================
// GENERATED SCHEDULE CASCADING FILTERS
// ============================================

get uniqueGeneratedDepartments(): string[] {
  return Array.from(new Set(
    this.generatedSchedule.map(e => e.DEPT).filter(d => d)
  )).sort();
}

onGeneratedDeptChange() {
  console.log('Department changed:', this.selectedGeneratedDept);
  
  // Reset dependent filters
  this.selectedGeneratedCourse = '';
  this.selectedGeneratedYear = null;
  this.availableGeneratedCourses = [];
  this.availableGeneratedYears = [];
  
  // Get courses for this department
  if (this.selectedGeneratedDept) {
    const coursesInDept = this.generatedSchedule
      .filter(e => e.DEPT_SUB === this.selectedGeneratedDept)
      .map(e => e.COURSE);
    
    this.availableGeneratedCourses = Array.from(new Set(coursesInDept)).sort();
  }
  
  this.applyGeneratedFilters();
}

onGeneratedCourseChange() {
  console.log('Course changed:', this.selectedGeneratedCourse);
  
  // Reset year filter
  this.selectedGeneratedYear = null;
  this.availableGeneratedYears = [];
  
  // Get years for this course (within department if selected)
  if (this.selectedGeneratedCourse) {
    let filtered = this.generatedSchedule.filter(e => e.COURSE === this.selectedGeneratedCourse);
    
    if (this.selectedGeneratedDept) {
      filtered = filtered.filter(e => e.DEPT === this.selectedGeneratedDept);
    }
    
    const yearsInCourse = filtered.map(e => e.YEAR_LEVEL);
    this.availableGeneratedYears = Array.from(new Set(yearsInCourse)).sort();
  }
  
  this.applyGeneratedFilters();
}

applyGeneratedFilters() {
  // Filters are applied through the filteredSchedule getter
  // Just trigger change detection
  this.cdr.detectChanges();
  
  console.log('Filters applied:', {
    dept: this.selectedGeneratedDept,
    course: this.selectedGeneratedCourse,
    year: this.selectedGeneratedYear,
    search: this.searchQuery,
    results: this.filteredSchedule.length
  });
}

clearGeneratedFilters() {
  this.selectedGeneratedDept = '';
  this.selectedGeneratedCourse = '';
  this.selectedGeneratedYear = null;
  this.availableGeneratedCourses = [];
  this.availableGeneratedYears = [];
  this.searchQuery = '';
  this.applyGeneratedFilters();
}


// 🔍 TEMPORARY DIAGNOSTIC METHOD - Add this after generateExamSchedule()
diagnosticRoomAssignment() {
  console.log('=== ROOM ASSIGNMENT DIAGNOSTIC ===\n');

  // 1. Check loaded exams
  const examsWithRooms = this.exams.filter(e => e.room && e.room.trim() !== '');
  console.log('📊 Exams loaded with original rooms: ' + examsWithRooms.length + ' / ' + this.exams.length);

  if (examsWithRooms.length > 0) {
    console.log('Sample exams WITH rooms from API:', examsWithRooms.slice(0, 5).map(e => ({
      code: e.code,
      room: e.room,
      dept: e.deptCode
    })));
  }

  const examsWithoutRooms = this.exams.filter(e => !e.room || e.room.trim() === '');
  console.log('\n⚠️ Exams loaded WITHOUT rooms: ' + examsWithoutRooms.length + ' / ' + this.exams.length);

  // 2. Check scheduled exams
  const needsRoom = this.generatedSchedule.filter(e => 
    e.ROOM === 'Please assign room' || e.ROOM === 'TBD'
  );
  console.log('\n🚨 Scheduled exams showing "Please assign room": ' + needsRoom.length + ' / ' + this.generatedSchedule.length);

  if (needsRoom.length > 0) {
    console.log('First 10 exams needing rooms:');
    needsRoom.slice(0, 10).forEach(e => {
      const original = this.exams.find(ex => ex.code === e.CODE);
      const roomValue = (original && original.room) || 'NONE';
      console.log('  - ' + e.CODE + ': original room = "' + roomValue + '", dept = ' + e.DEPT_SUB);
    });
  }

  // 3. Check room availability
  console.log('\n🏢 Total rooms loaded from API: ' + this.rooms.length);
  console.log('Sample rooms:', this.rooms.slice(0, 15).join(', '));

  const availableRooms = this.getAvailableRooms(this.rooms);
  console.log('\n✅ Available rooms (after filtering restricted): ' + availableRooms.length);
  console.log('Sample available:', availableRooms.slice(0, 15).join(', '));

  console.log('\n🚫 Restricted rooms: ' + this.restrictedRooms.length);

  // 4. Check if original rooms are available
  console.log('\n🔍 Checking if original rooms are available:');
  needsRoom.slice(0, 5).forEach(e => {
    const original = this.exams.find(ex => ex.code === e.CODE);
    if (original && original.room) {
      const isRestricted = this.restrictedRooms.includes(original.room);
      const isInRoomsList = this.rooms.includes(original.room);
      const isAvailable = availableRooms.includes(original.room);
      console.log('  ' + e.CODE + ' (' + original.room + '): restricted=' + isRestricted + ', inRoomsList=' + isInRoomsList + ', isAvailable=' + isAvailable);
    }
  });
}
loadExamData() {
  if (!this.activeTerm) {
    this.global.swalAlertError('Please select a term/year first');
    return;
  }

  this.loadSwal();

  this.api.getCodeSummaryReport(this.activeTerm)
    .map((response: any) => response.json())
    .subscribe(
      res => {
        this.rawCodes = res.data;
        // 🔍 DEBUG: Check first 3 items to see available fields
        console.log('=== RAW API DATA SAMPLE ===');
        console.log('First 3 exams from API:', this.rawCodes.slice(0, 3));
        console.log('\nAvailable fields in first exam:', 
          this.rawCodes[0] ? Object.keys(this.rawCodes[0]) : 'NO DATA'
        );  
        
        
        Swal.close();

      const parsedExams: Exam[] = this.rawCodes.map((obj: any) => ({
  code: obj.codeNo || '',
  version: obj.version || '',
  subjectId: obj.subjectId || '',
  title: obj.subjectTitle || '',
  course: (obj.course || '').trim(),
  yearLevel: obj.yearLevel !== undefined && obj.yearLevel !== null ? obj.yearLevel : 1,
  lec: parseInt(obj.lecUnits || 3),
  lab: parseInt(obj.labUnits || 0),
  oe: parseInt(obj.oe || 0),
  dept: obj.dept || '',
  deptCode: obj.deptCode || '',
  instructor: obj.instructor || '',
  room: obj.roomNumber || obj.ROOM_NUMBER || obj.ROOM || '' // ← ADD THIS LINE
}));

        console.log('📋 api:', this.rawCodes);

        // 🔥 RESTRICT SAS: remove from scheduling list
         this.UnenrolledExam = parsedExams.filter(e =>  e.oe === 0);
        this.exams = parsedExams.filter(e => e.dept.toUpperCase() !== 'SAS' && e.oe > 0);
         
        
        // Still get rooms
        this.rooms = this.getUniqueRooms(res.data);

        if (this.rooms.length === 0) {
          this.rooms = ['A', 'C', 'K', 'L', 'M', 'N'];
        }

        this.showToast('Success', `${this.exams.length} exams loaded  `);
       

        
        // ✅ FIX: Force change detection immediately
        this.cdr.detectChanges();
        
        console.log('✅ Change detection triggered, exams loaded:', this.exams.length);
      },
      err => {
        Swal.close();
        this.global.swalAlertError(err);
        this.cdr.detectChanges(); // Also trigger on error
      }
    );
}


  getUniqueRooms(data: any[]): string[] {
    const roomSet = new Set<string>();
    data.forEach(item => {
      if (item.roomNumber || item.ROOM_NUMBER || item.ROOM) {
        const room = item.roomNumber || item.ROOM_NUMBER || item.ROOM;
        roomSet.add(room);
      }
    });
    return Array.from(roomSet).sort();
  }
  


  loadSwal() {
    Swal.fire({
      title: 'Loading',
      text: 'Fetching exam data...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      onOpen: function () {
        Swal.showLoading();
      }
    });
  }

  showToast(title: string, description: string, variant: string = 'success') {
    this.toast = { title, description, variant };
    setTimeout(() => {
      this.toast = null;
    }, 3000);
  }

  areSlotConsecutive(slot1: string, slot2: string): boolean {
    const idx1 = this.timeSlots.indexOf(slot1);
    const idx2 = this.timeSlots.indexOf(slot2);
    return Math.abs(idx1 - idx2) === 1;
  }

  hasConsecutiveExamsInSlot(course: string, day: string, proposedSlot: string, excludeSubjectId?: string): boolean {
    const courseExamsOnDay = this.generatedSchedule.filter(
      e => e.COURSE.toUpperCase().trim() === course.toUpperCase().trim() && 
           e.DAY === day &&
           (!excludeSubjectId || e.SUBJECT_ID !== excludeSubjectId)
    );

    for (const exam of courseExamsOnDay) {
      if (this.areSlotConsecutive(exam.SLOT, proposedSlot)) {
        return true;
      }
    }
    return false;
  }

  // assignRoomByDepartment(exam: Exam, usedRoomsSet: Set<string>, roomsList: string[]): string | null {
  //   const deptCode = exam.dept ? exam.deptCode.toUpperCase() : '';
  //   const course = exam.course ? exam.course.toUpperCase() : '';

  //   let preferredPrefixes: string[] = [];

  //   if (deptCode === 'SABH' || deptCode === 'SECAP') {
  //     preferredPrefixes = ['A'];
  //   } else if (course.startsWith('BSA')) {
  //     preferredPrefixes = ['C', 'K'];
  //   } else if (deptCode === 'SACE') {
  //     preferredPrefixes = ['N', 'K'];
  //   } else if (deptCode === 'SHAS') {
  //     preferredPrefixes = ['M', 'L'];
  //   }

  //   let availableRoom = roomsList.find(r =>
  //       r.includes('-') &&            
  //     preferredPrefixes.some(prefix => r.startsWith(prefix)) &&
  //     !usedRoomsSet.has(r)
  //   );

  //   if (!availableRoom) {
  //     availableRoom = roomsList.find(r => 
  //       r.includes('-') &&  
  //       !usedRoomsSet.has(r));
  //   }

    

  //   return availableRoom || 'TBD';
  // }


assignRoomByDepartment(exam: Exam, usedRoomsSet: Set<string>, roomsList: string[]): string | null {
  // ========================================
  // TIER 1: Try original room from ERP
  // ========================================
  const originalRoom = exam.room ? exam.room.trim() : '';
  
  if (originalRoom) {
    const isRestricted = this.restrictedRooms.includes(originalRoom);
    const isInRoomsList = roomsList.includes(originalRoom);
    const isOccupied = usedRoomsSet.has(originalRoom);
    
    // ✅ Original room is available - USE IT
    if (!isRestricted && isInRoomsList && !isOccupied) {
      console.log(`✓ ${exam.code}: Using original room ${originalRoom}`);
      return originalRoom;
    } else {
      // Log why we can't use original room
      if (isRestricted) {
        console.log(`⚠️ ${exam.code}: Original room ${originalRoom} is RESTRICTED`);
      } else if (!isInRoomsList) {
        console.log(`⚠️ ${exam.code}: Original room ${originalRoom} NOT in available list`);
      } else if (isOccupied) {
        console.log(`⚠️ ${exam.code}: Original room ${originalRoom} is OCCUPIED in this slot`);
      }
    }
  }
  
  // ========================================
  // TIER 2: Try same building as original
  // ========================================
  if (originalRoom && !this.restrictedRooms.includes(originalRoom)) {
    const buildingPrefix = originalRoom.split('-')[0]; // e.g., "A" from "A-216"
    const sameBuildingRoom = roomsList.find(r => 
      r.startsWith(buildingPrefix) && !usedRoomsSet.has(r)
    );
    
    if (sameBuildingRoom) {
      console.log(`✓ ${exam.code}: Using same building ${sameBuildingRoom} (original: ${originalRoom})`);
      return sameBuildingRoom;
    } else {
      console.log(`⚠️ ${exam.code}: All rooms in building ${buildingPrefix} are occupied`);
    }
  }
  
  // ========================================
  // TIER 3: Department preference
  // ========================================
  const deptCode = exam.deptCode ? exam.deptCode.toUpperCase() : '';
  const course = exam.course ? exam.course.toUpperCase() : '';
  
  let preferredPrefixes: string[] = [];
  if (deptCode === 'SABH') preferredPrefixes = ['A'];
  else if (deptCode === 'SECAP') preferredPrefixes = ['N', 'M', 'A', 'L', 'C', 'K'];
  else if (course.startsWith('BSA')) preferredPrefixes = ['C', 'K'];
  else if (deptCode === 'SACE') preferredPrefixes = ['N', 'K'];
  else if (deptCode === 'SHAS') preferredPrefixes = ['M', 'L', 'N'];

  if (preferredPrefixes.length > 0) {
    const deptRoom = roomsList.find(r => 
      preferredPrefixes.some(p => r.startsWith(p)) &&
      !usedRoomsSet.has(r)
    );
    
    if (deptRoom) {
      console.log(`✓ ${exam.code}: Using department room ${deptRoom}`);
      return deptRoom;
    } else {
      console.log(`⚠️ ${exam.code}: All ${deptCode} department rooms occupied`);
    }
  }
  
  // ========================================
  // TIER 4: ANY available room (fallback)
  // ========================================
  const anyRoom = roomsList.find(r => !usedRoomsSet.has(r));
  
  if (anyRoom) {
    console.log(`✓ ${exam.code}: Using fallback room ${anyRoom}`);
    return anyRoom;
  }
  
  // ========================================
  // NO ROOMS AVAILABLE
  // ========================================
  console.error(`❌ ${exam.code}: ALL ${roomsList.length} rooms occupied in this slot (${usedRoomsSet.size} used)`);
  return 'TBD';
}

// Add this method to filter available rooms based on department preferences
// Add this method to filter available rooms based on department preferences
getAvailableRoomsForExam(exam: ScheduledExam, day: string, slot: string): string[] {
  if (!day || !slot) return [];

  const deptCode = exam.DEPT ? exam.DEPT.toUpperCase() : '';
  const course = exam.COURSE ? exam.COURSE.toUpperCase() : '';

  // Define department-based room prefixes
  let preferredPrefixes: string[] = [];
  if (deptCode === 'SABH') {
    preferredPrefixes = ['A'];
  } else if (deptCode === 'SECAP') {
    preferredPrefixes = ['N', 'M', 'A', 'L', 'C', 'K'];
  } else if (course.startsWith('BSA')) {
    preferredPrefixes = ['C', 'K'];
  } else if (deptCode === 'SACE') {
    preferredPrefixes = ['N', 'K'];
  } else if (deptCode === 'SHAS') {
    preferredPrefixes = ['M', 'L', 'N'];
  }

  // Get all rooms for this day/slot that aren't already assigned
  const usedRoomsForSlot = new Set<string>();
  this.generatedSchedule.forEach(e => {
    if (e.DAY === day && e.SLOT === slot && e.ROOM && e.ROOM !== 'TBD') {
      // Don't mark current exam's room as used (allow keeping same room)
      if (e.CODE !== exam.CODE) {
        usedRoomsForSlot.add(e.ROOM);
      }
    }
  });

  // Get all available rooms from your rooms list
  const allRooms = this.rooms || []; // Adjust based on your rooms array name

  // Filter rooms: not used AND match department preferences (if any)
  let availableRooms = allRooms.filter(room => !usedRoomsForSlot.has(room));

  // If department has preferred prefixes, prioritize those rooms
  if (preferredPrefixes.length > 0) {
    const preferredRooms = availableRooms.filter(room =>
      preferredPrefixes.some(prefix => room.startsWith(prefix))
    );

    // If preferred rooms exist, show them first
    if (preferredRooms.length > 0) {
      // Show preferred rooms first, then other available rooms
      const otherRooms = availableRooms.filter(room =>
        !preferredPrefixes.some(prefix => room.startsWith(prefix))
      );
      return [...preferredRooms, ...otherRooms];
    }
  }

  return availableRooms;
}

// Update your onEditSlotChange method to use the new logic
onEditSlotChange(): void {
  if (!this.editedExam || !this.editedExam.DAY || !this.editedExam.SLOT) {
    this.availableRooms = [];
    return;
  }

  // Use the new department-aware room filtering
  this.availableRooms = this.getAvailableRoomsForExam(
    this.editedExam,
    this.editedExam.DAY,
    this.editedExam.SLOT
  );

  // Clear room selection if current room is no longer available
  if (this.editedExam.ROOM && !this.availableRooms.includes(this.editedExam.ROOM)) {
    this.editedExam.ROOM = '';
  }
}

// Optional: Add a method to show room recommendations in the UI
getRoomRecommendation(exam: ScheduledExam, room: string): string {
  const deptCode = exam.DEPT ? exam.DEPT.toUpperCase() : '';
  const course = exam.COURSE ? exam.COURSE.toUpperCase() : '';

  let preferredPrefixes: string[] = [];
  if (deptCode === 'SABH') preferredPrefixes = ['A'];
  else if (deptCode === 'SECAP') preferredPrefixes = ['N', 'M', 'A', 'L', 'C', 'K'];
  else if (course.startsWith('BSA')) preferredPrefixes = ['C', 'K'];
  else if (deptCode === 'SACE') preferredPrefixes = ['N', 'K'];
  else if (deptCode === 'SHAS') preferredPrefixes = ['M', 'L', 'N'];

  if (preferredPrefixes.length > 0 && preferredPrefixes.some(p => room.startsWith(p))) {
    return '⭐ Recommended for ' + deptCode;
  }
  return '';
}

hasRecommendedRooms(exam: ScheduledExam): boolean {
  if (!this.availableRooms || this.availableRooms.length === 0) return false;
  
  return this.availableRooms.some(room => 
    this.getRoomRecommendation(exam, room) !== ''
  );
}

//  getFreeRoomForSlot(exam: Exam, day: string, slot: string, roomsList: string[]): string {
//   const slotKey = `${day}_${slot}`;

//   if (!this.usedRoomsPerSlot[slotKey]) {
//     this.usedRoomsPerSlot[slotKey] = new Set<string>();
//   }

//   const roomsAlreadyUsed = this.usedRoomsPerSlot[slotKey];
//   const room = this.assignRoomByDepartment(exam, roomsAlreadyUsed, roomsList) || '';

//   // Mark room as used for this slot
//   if (room) roomsAlreadyUsed.add(room);

//   return room;
// }

getFreeRoomForSlot(exam: Exam, day: string, slot: string, roomsList: string[]): string {
  const key = `${day}_${slot}`;
  if (!this.usedRoomsPerSlot[key]) this.usedRoomsPerSlot[key] = new Set();
  const room = this.assignRoomByDepartment(exam, this.usedRoomsPerSlot[key], roomsList);
  if (room !== 'TBD') this.usedRoomsPerSlot[key].add(room);
  return room;
}


// getFreeRoomForMultiSlot(exam: Exam, day: string, slots: string[], roomsList: string[]): string {
//   const usedRoomsPerThisMultiSlot = new Set<string>();
  
//   // Check which rooms are used in ANY of the slots
//   for (const slot of slots) {
//     const key = `${day}_${slot}`;
//     if (!this.usedRoomsPerSlot[key]) {
//       this.usedRoomsPerSlot[key] = new Set();
//     }
//     this.usedRoomsPerSlot[key].forEach(room => usedRoomsPerThisMultiSlot.add(room));
//   }

//   // Find a room that's free in ALL slots
//   let assignedRoom = this.assignRoomByDepartment(exam, usedRoomsPerThisMultiSlot, roomsList) || '';

//   // Mark this room as used for ALL slots
//   if (assignedRoom) {
//     for (const slot of slots) {
//       const key = `${day}_${slot}`;
//       if (!this.usedRoomsPerSlot[key]) {
//         this.usedRoomsPerSlot[key] = new Set();
//       }
//       this.usedRoomsPerSlot[key].add(assignedRoom);
//     }
//   }

//   return assignedRoom;
// }

getFreeRoomForMultiSlot(exam: Exam, day: string, slots: string[], roomsList: string[]): string {
  const usedRoomsPerThisMultiSlot = new Set<string>();
  
  // Collect all rooms used in any of the slots
  for (const slot of slots) {
    const key = `${day}_${slot}`;
    if (!this.usedRoomsPerSlot[key]) this.usedRoomsPerSlot[key] = new Set();
    this.usedRoomsPerSlot[key].forEach(r => usedRoomsPerThisMultiSlot.add(r));
  }

  // Assign a room based on department rules
  const assignedRoom = this.assignRoomByDepartment(exam, usedRoomsPerThisMultiSlot, roomsList);

  // Mark this room as used in all slots
  if (assignedRoom !== 'TBD') {
    for (const slot of slots) {
      this.usedRoomsPerSlot[`${day}_${slot}`].add(assignedRoom);
    }
  }

  return assignedRoom;
}


  // NEW: Detect proctor conflicts
  // detectProctorConflicts() {
  //   this.conflictingExams = [];
  //   this.availableProctors.clear();

  //   // Group exams by day and slot
  //   const examsByDaySlot: { [key: string]: ScheduledExam[] } = {};
    
  //   this.generatedSchedule.forEach(exam => {
  //     const key = `${exam.DAY}|${exam.SLOT}`;
  //     if (!examsByDaySlot[key]) {
  //       examsByDaySlot[key] = [];
  //     }
  //     examsByDaySlot[key].push(exam);
  //   });

  //   // Check for conflicts (instructor teaching multiple classes at same time)
  //   Object.values(examsByDaySlot).forEach(examsInSlot => {
  //     const instructorCount: { [instructor: string]: number } = {};
      
  //     examsInSlot.forEach(exam => {
  //       const instructor = exam.INSTRUCTOR.toUpperCase().trim();
  //       instructorCount[instructor] = (instructorCount[instructor] || 0) + 1;
  //     });

  //     // Mark exams with conflicts
  //     examsInSlot.forEach(exam => {
  //       const instructor = exam.INSTRUCTOR.toUpperCase().trim();
  //       if (instructorCount[instructor] > 1) {
  //         exam.HAS_CONFLICT = true;
  //         this.conflictingExams.push(exam);
          
  //         // Find available substitute proctors
  //         this.findAvailableProctors(exam);
  //       } else {
  //         exam.HAS_CONFLICT = false;
  //       }
  //     });
  //   });

  //   if (this.conflictingExams.length > 0) {
  //     this.showToast(
  //       'Proctor Conflicts Detected',
  //       `${this.conflictingExams.length} exams have proctor conflicts. Please assign substitute proctors.`,
  //       'warning'
  //     );
  //   }
  // }
// NEW: Detect only PROCTOR conflicts (for Proctor Assignment view)
detectProctorConflicts() {
  console.log('🔍 Detecting proctor conflicts...');
  
  // Reset
  this.conflictingExams = [];
  this.availableProctors.clear();
  
  // Reset only proctor conflicts
  this.conflictDetails.proctorConflicts = [];

  // Group exams by day and slot
  const examsByDaySlot: { [key: string]: ScheduledExam[] } = {};
  
  this.generatedSchedule.forEach(exam => {
    const key = `${exam.DAY}|${exam.SLOT}`;
    if (!examsByDaySlot[key]) {
      examsByDaySlot[key] = [];
    }
    examsByDaySlot[key].push(exam);
  });

  let totalProctorConflicts = 0;

  // Check ONLY for PROCTOR conflicts
  Object.entries(examsByDaySlot).forEach(([key, examsInSlot]) => {
    const [day, slot] = key.split('|');
    
    const proctorCount: { [proctor: string]: ScheduledExam[] } = {};
    examsInSlot.forEach(exam => {
      if (exam.PROCTOR && exam.PROCTOR !== 'TBD') {
        const proctor = exam.PROCTOR.toUpperCase().trim();
        if (!proctorCount[proctor]) {
          proctorCount[proctor] = [];
        }
        proctorCount[proctor].push(exam);
      }
    });

    Object.entries(proctorCount).forEach(([proctor, exams]) => {
      if (exams.length > 1) {
        totalProctorConflicts++;
        this.conflictDetails.proctorConflicts.push({
          proctor,
          day,
          slot,
          exams
        });
        
        exams.forEach(exam => {
          exam.HAS_CONFLICT = true;
          if (!this.conflictingExams.includes(exam)) {
            this.conflictingExams.push(exam);
          }
        });
        
        console.warn(`⚠️ Proctor conflict: ${proctor} assigned to ${exams.length} exams at ${day} ${slot}`);
      }
    });
  });

  console.log(`\n📊 Proctor Conflicts: ${totalProctorConflicts}`);

  if (totalProctorConflicts > 0) {
    this.showToast(
      'Proctor Conflicts Detected',
      `${totalProctorConflicts} proctor conflict(s) found.`,
      'warning'
    );
  }
}
// NEW: Detect only ROOM conflicts (for Generated Schedule view)
detectScheduleConflicts() {
  console.log('🔍 Detecting schedule conflicts (rooms + TBD)...');
  
  // Reset conflicts for generate view
  this.conflictDetails.roomConflicts = [];

  // Clear HAS_CONFLICT flag first
  this.generatedSchedule.forEach(exam => {
    exam.HAS_CONFLICT = false;
  });

  // Group exams by day and slot
  const examsByDaySlot: { [key: string]: ScheduledExam[] } = {};
  
  this.generatedSchedule.forEach(exam => {
    const key = `${exam.DAY}|${exam.SLOT}`;
    if (!examsByDaySlot[key]) {
      examsByDaySlot[key] = [];
    }
    examsByDaySlot[key].push(exam);
  });

  let totalRoomConflicts = 0;
  let totalTBDRooms = 0;

  // Check for ROOM conflicts (same room, same time)
  Object.entries(examsByDaySlot).forEach(([key, examsInSlot]) => {
    const [day, slot] = key.split('|');
    
    const roomCount: { [room: string]: ScheduledExam[] } = {};
    examsInSlot.forEach(exam => {
      const room = exam.ROOM.toUpperCase().trim();
      if (room && room !== 'TBD' && room !== 'PLEASE ASSIGN ROOM') {
        if (!roomCount[room]) {
          roomCount[room] = [];
        }
        roomCount[room].push(exam);
      }
    });

    // Mark room conflicts
    Object.entries(roomCount).forEach(([room, exams]) => {
      if (exams.length > 1) {
        totalRoomConflicts++;
        this.conflictDetails.roomConflicts.push({
          room,
          day,
          slot,
          exams
        });
        
        exams.forEach(exam => {
          exam.HAS_CONFLICT = true;
        });
        
        console.error(`🚨 ROOM CONFLICT: Room ${room} assigned to ${exams.length} exams at ${day} ${slot}`);
      }
    });
  });

  // Check for TBD/missing rooms
  this.generatedSchedule.forEach(exam => {
    const room = exam.ROOM.toUpperCase().trim();
    if (!room || room === 'TBD' || room === 'PLEASE ASSIGN ROOM') {
      exam.HAS_CONFLICT = true;
      totalTBDRooms++;
    }
  });

  console.log(`\n📊 Schedule Conflicts:`);
  console.log(`  - Room Conflicts: ${totalRoomConflicts}`);
  console.log(`  - TBD/Missing Rooms: ${totalTBDRooms}`);

  if (totalRoomConflicts > 0) {
    this.showToast(
      'Room Conflicts Detected',
      `${totalRoomConflicts} room conflict(s) found. Same room assigned to multiple exams.`,
      'warning'
    );
  }

  if (totalTBDRooms > 0) {
    this.showToast(
      'Missing Rooms',
      `${totalTBDRooms} exam(s) need room assignment.`,
      'warning'
    );
  }
}


getTotalConflicts(): number {
  // Show only relevant conflicts based on current view
  if (this.currentStep === 'generate') {
    return this.conflictDetails.roomConflicts.length;
  } else if (this.currentStep === 'proctor') {
    return this.conflictDetails.proctorConflicts.length;
  }
  return 0;
}


 
  // NEW: Get all unique proctors
  get uniqueProctors(): string[] {
  const proctors = new Set<string>();
  this.generatedSchedule.forEach(e => {
    if (e.PROCTOR) {
      proctors.add(e.PROCTOR);
    }
  });
  return Array.from(proctors).sort();
}


  // NEW: Find available substitute proctors for an exam
  findAvailableProctors(exam: ScheduledExam) {
    const availableInstructors: string[] = [];
    
    // Find all instructors who teach the same subject
    const sameSubjectInstructors = new Set<string>();
    this.exams.forEach(e => {
      if (e.title.toUpperCase().trim() === exam.DESCRIPTIVE_TITLE.toUpperCase().trim() &&
          e.instructor.toUpperCase().trim() !== exam.INSTRUCTOR.toUpperCase().trim()) {
        sameSubjectInstructors.add(e.instructor);
      }
    });

    // Check which of these instructors are available (not teaching at this time)
    sameSubjectInstructors.forEach(instructor => {
      const isBusy = this.generatedSchedule.some(e => 
        e.DAY === exam.DAY &&
        e.SLOT === exam.SLOT &&
        e.INSTRUCTOR.toUpperCase().trim() === instructor.toUpperCase().trim()
      );
      
      if (!isBusy) {
        availableInstructors.push(instructor);
      }
    });

    this.availableProctors.set(exam.CODE, availableInstructors);
  }

  // NEW: Assign substitute proctor
  assignProctor(exam: ScheduledExam, proctor: string) {
    const index = this.generatedSchedule.findIndex(e => e.CODE === exam.CODE);
    if (index !== -1) {
      this.generatedSchedule[index].PROCTOR = proctor;
      this.generatedSchedule[index].HAS_CONFLICT = false;
      
      // Remove from conflicting exams list
      this.conflictingExams = this.conflictingExams.filter(e => e.CODE !== exam.CODE);
      
      this.showToast('Proctor Assigned', `${proctor} assigned to proctor ${exam.DESCRIPTIVE_TITLE}`);
      this.autoSaveToLocalStorage();
      this.cd.detectChanges();
    }
  }


  // NEW: Get proctor schedule (all exams a proctor is assigned to)
  getProctorSchedule(instructor: string): ScheduledExam[] {
    return this.generatedSchedule.filter(e => 
      e.PROCTOR && e.PROCTOR.toUpperCase().trim() === instructor.toUpperCase().trim()
    ).sort((a, b) => {
      if (a.DAY !== b.DAY) return a.DAY.localeCompare(b.DAY);
      return a.SLOT.localeCompare(b.SLOT);
    });
  }

  



getProctorMatchDetails(exam: ScheduledExam, proctor: string): {
  matchesSubject: boolean;
  matchesDept: boolean;
  subjectsInCommon: string[];
  proctorDept: string;
} {
  const proctorUpper = proctor.toUpperCase().trim();
  const examSubject = exam.SUBJECT_ID ? exam.SUBJECT_ID.toUpperCase().trim() : "";
  const examDept = exam.DEPT ? exam.DEPT.toUpperCase().trim() : "";
  
  const proctorSubjects = this.instructorSubjects.get(proctorUpper) || new Set();
  const proctorDept = this.instructorDepartments.get(proctorUpper) || 'Unknown';
  
  const matchesSubject = examSubject && proctorSubjects.has(examSubject);
  const matchesDept = examDept && proctorDept.toUpperCase() === examDept;
  
  // Find all subjects in common
  const subjectsInCommon: string[] = [];
  if (proctorSubjects.size > 0) {
    proctorSubjects.forEach(subject => {
      subjectsInCommon.push(subject);
    });
  }
  
  return {
    matchesSubject,
    matchesDept,
    subjectsInCommon: subjectsInCommon.sort(),
    proctorDept
  };
}

// ENHANCED: Get match type badge with detailed matching
getProctorMatchType(exam: ScheduledExam, proctor: string): {
  type: 'same-subject' | 'same-dept' | 'available';
  label: string;
  icon: string;
  details: string;
} {
  const details = this.getProctorMatchDetails(exam, proctor);
  
  if (details.matchesSubject && details.matchesDept) {
    return { 
      type: 'same-subject', 
      label: 'Perfect Match', 
      icon: '🎯',
      details: `Same subject (${exam.SUBJECT_ID}) & dept (${exam.DEPT})`
    };
  } else if (details.matchesSubject) {
    return { 
      type: 'same-subject', 
      label: 'Same Subject', 
      icon: '🎯',
      details: `Teaches ${exam.SUBJECT_ID}`
    };
  } else if (details.matchesDept) {
    return { 
      type: 'same-dept', 
      label: 'Same Dept', 
      icon: '🏛️',
      details: `${details.proctorDept} department`
    };
  } else {
    return { 
      type: 'available', 
      label: 'Available', 
      icon: '✓',
      details: `From ${details.proctorDept} dept`
    };
  }
}




// 7. Filter available proctors by department
getProctorsByDepartment(exam: ScheduledExam, department: string): string[] {
  const suggestions = this.getSmartProctorSuggestions(exam);
  const allAvailable = [
    ...suggestions.sameSubject,
    ...suggestions.sameDept,
    ...suggestions.available
  ];
  
  return allAvailable.filter(instructor => {
    const dept = this.getInstructorDepartment(instructor);
    return dept.toUpperCase() === department.toUpperCase();
  });
}

// 8. Filter available proctors by subject
getProctorsBySubject(exam: ScheduledExam, subject: string): string[] {
  const suggestions = this.getSmartProctorSuggestions(exam);
  const allAvailable = [
    ...suggestions.sameSubject,
    ...suggestions.sameDept,
    ...suggestions.available
  ];
  
  return allAvailable.filter(instructor => {
    const subjects = this.getInstructorSubjects(instructor);
    return subjects.some(s => s.includes(subject.toUpperCase()));
  });
}


// Cache for match types to avoid recomputation
private matchTypeCache = new Map<string, any>();

// Get cached match type
getCachedProctorMatchType(exam: ScheduledExam, proctor: string): {
  type: 'same-subject' | 'same-dept' | 'available';
  label: string;
  icon: string;
} {
  const key = `${exam.CODE}_${proctor}`;
  
  if (!this.matchTypeCache.has(key)) {
    this.matchTypeCache.set(key, this.getProctorMatchType(exam, proctor));
  }
  
  return this.matchTypeCache.get(key);
}

// Clear cache when assignments change
clearMatchTypeCache() {
  this.matchTypeCache.clear();
}



// FIXED: Refresh proctor view to ensure dropdowns update
refreshProctorView() {
  console.log('Refreshing proctor view...');
  
  // Force Angular to re-evaluate everything
  this.cd.detectChanges();
  
  // Log stats for debugging
  console.log('Current stats:', {
    total: this.totalExams,
    assigned: this.assignedExams,
    conflicts: this.conflictExams,
    proctors: this.totalProctors
  });
  
  // Force a second update after a delay to ensure dropdowns populate
  setTimeout(() => {
    this.cd.detectChanges();
    console.log('Second refresh complete');
  }, 100);
}



// 11. Force UI refresh with multiple cycles
forceProctorUIRefresh() {
  console.log('Forcing proctor UI refresh...');
  
  // Immediate refresh
  this.cd.detectChanges();
  
  // Secondary refresh after 50ms
  setTimeout(() => {
    this.cd.detectChanges();
    console.log('Secondary refresh complete');
  }, 50);
  
  // Final refresh after 150ms to ensure dropdowns populate
  setTimeout(() => {
    this.cd.detectChanges();
    console.log('Final refresh complete');
  }, 150);
}




  downloadScheduleCSV() {
    if (this.generatedSchedule.length === 0) return;

    const headers = ['Code', 'Subject ID', 'Title', 'Course', 'Year Level', 'Instructor', 'Dept', 'Day', 'Time', 'Room', 'Proctor', 'Has Conflict'];
    const rows = this.generatedSchedule.map(item => [
      item.CODE, item.SUBJECT_ID, item.DESCRIPTIVE_TITLE, item.COURSE,
      item.YEAR_LEVEL, item.INSTRUCTOR, item.DEPT, item.DAY, item.SLOT, item.ROOM,
      item.PROCTOR || item.INSTRUCTOR, item.HAS_CONFLICT ? 'Yes' : 'No'
    ]);

    let csv = headers.join(',') + '\n';
    rows.forEach(row => {
      csv += row.join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    saveAs(blob, 'exam_schedule_with_proctors.csv');
  }

  generateCourseSummaryData() {
    const summaryMap: { [course: string]: ScheduledExam[] } = {};
    this.generatedSchedule.forEach(exam => {
      if (!summaryMap[exam.COURSE]) summaryMap[exam.COURSE] = [];
      summaryMap[exam.COURSE].push(exam);
    });

    const sorted = Object.keys(summaryMap).sort();
    this.courseSummary = sorted.map(course => {
      const courseExams = summaryMap[course].sort((a, b) => {
        if (a.YEAR_LEVEL !== b.YEAR_LEVEL) return a.YEAR_LEVEL - b.YEAR_LEVEL;
        if (a.DAY !== b.DAY) return a.DAY.localeCompare(b.DAY);
        return a.SLOT.localeCompare(b.SLOT);
      });

      const yearLevelGroups: { [yearLevel: number]: any[] } = {};
      
      courseExams.forEach(exam => {
        const yearLevel = exam.YEAR_LEVEL || 1;
        if (!yearLevelGroups[yearLevel]) {
          yearLevelGroups[yearLevel] = [];
        }
        
        let group = yearLevelGroups[yearLevel].find(g => 
          g.day === exam.DAY && g.slot === exam.SLOT
        );
        
        if (!group) {
          group = { day: exam.DAY, slot: exam.SLOT, exams: [] };
          yearLevelGroups[yearLevel].push(group);
        }
        
        group.exams.push(exam);
      });

      const yearLevelGroupsArray = Object.keys(yearLevelGroups)
        .map(Number)
        .sort((a, b) => a - b)
        .map(yearLevel => ({
          yearLevel,
          groups: yearLevelGroups[yearLevel]
        }));

      return { course, yearLevelGroups: yearLevelGroupsArray };
    });
  }

  viewCourseSummary() {
    this.generateCourseSummaryData();
    this.currentStep = 'summary';
  }

  generateRoomTimeTableData() {
    const uniqueRooms = Array.from(new Set(this.generatedSchedule.map(e => e.ROOM))).sort();
    const uniqueDays = Array.from(new Set(this.generatedSchedule.map(e => e.DAY)));

    const table: any = {};
    uniqueDays.forEach(day => {
      table[day] = {};
      uniqueRooms.forEach(room => {
        table[day][room] = {};
        this.timeSlots.forEach(slot => {
          table[day][room][slot] = null;
        });
      });
    });

    this.generatedSchedule.forEach(exam => {
      table[exam.DAY][exam.ROOM][exam.SLOT] = {
        code: exam.CODE,
        course: exam.COURSE,
        yearLevel: exam.YEAR_LEVEL || 1,
        dept: exam.DEPT,
        title: exam.DESCRIPTIVE_TITLE
      };
    });

    this.roomTimeData = { table, rooms: uniqueRooms, days: uniqueDays };
    this.activeDay = uniqueDays[0] || 'Day 1';
  }

  viewRoomTimeTable() {
    this.generateRoomTimeTableData();
    this.currentStep = 'timetable';
  }



  getDeptColor(dept: string): string {
    const colors: { [key: string]: string } = {
      'SACE': '#ef4444',
      'SABH': '#facc15',
      'SECAP': '#3b82f6',
      'SHAS': '#22c55e'
    };
    return dept ? colors[dept.toUpperCase()] || '#6b7280' : '#6b7280';
  }

  getDeptGradient(dept: string): string {
    const gradients: { [key: string]: string } = {
      'SACE': 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
      'SABH': 'linear-gradient(135deg, #facc15 0%, #eab308 100%)',
      'SECAP': 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
      'SHAS': 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
    };
    return dept ? gradients[dept.toUpperCase()] || 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)' : 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
  }

  


trackByExam(index: number, exam: ScheduledExam): string {
  return `${exam.CODE}|${exam.SUBJECT_ID}|${exam.DAY}|${exam.SLOT}`;
}

getRealIndex(exam: ScheduledExam): number {
  return this.generatedSchedule.indexOf(exam);
}

getExamKey(exam: ScheduledExam): string {
  // Create unique key that won't change
  return `${exam.CODE}|${exam.SUBJECT_ID}|${exam.DESCRIPTIVE_TITLE}|${exam.COURSE}`;
}

isExamBeingEdited(exam: ScheduledExam): boolean {
  if (!this.editingExamKey) return false;
  return this.getExamKey(exam) === this.editingExamKey;
  
}


// startEdit(displayIndex: number) {
//   console.log('=== startEdit called ===');
//   console.log('Display index:', displayIndex);

//   // Get exam from filtered list (what user sees)
//   const examToEdit = this.filteredSchedule[displayIndex];

//   if (!examToEdit) {
//     console.error('❌ Exam not found at display index:', displayIndex);
//     return;
//   }

//   const examKey = this.getExamKey(examToEdit);
//   console.log('🔑 Exam key:', examKey);
//   console.log('📋 Exam to edit:', examToEdit);

//   // Find in original schedule for reference
//   const originalIndex = this.generatedSchedule.findIndex(
//     e => this.getExamKey(e) === examKey
//   );

//   if (originalIndex === -1) {
//     console.error('❌ Exam not found in generatedSchedule');
//     return;
//   }

//   console.log('✅ Found at real index:', originalIndex);

//   // Store the KEY (not index) to track what's being edited
//   this.editingExamKey = examKey;

//   // Create a clean copy for editing
//   this.editedExam = JSON.parse(JSON.stringify(examToEdit));

//   console.log('✏️ Edit mode started for:', this.editingExamKey);
//   console.log('Exam data:', this.editedExam);

//   // Load available options
//   this.availableSlots = [];
//   this.availableRooms = [];
//   this.onEditDayChange();

//   if (this.editedExam.DAY && this.editedExam.SLOT) {
//     this.onEditSlotChange();
//   }
// }


startEdit(displayIndex: number) {
  console.log('=== startEdit called ===');
  console.log('Display index:', displayIndex);

  // Get exam from DISPLAYED list (already filtered for first slots only)
  const examToEdit = this.displayedSchedule[displayIndex];

  if (!examToEdit) {
    console.error('❌ Exam not found at display index:', displayIndex);
    return;
  }

  console.log('📋 Exam to edit:', examToEdit);

  // Store the DISPLAY index (not the real index)
  // This allows us to highlight the correct row in the table
  this.editingRow = displayIndex;

  // Create a clean copy for editing
  this.editedExam = JSON.parse(JSON.stringify(examToEdit));

  console.log('✏️ Edit mode started for display index:', this.editingRow);

  // Load available options
  this.availableSlots = [];
  this.availableRooms = [];
  this.onEditDayChange();

  if (this.editedExam.DAY && this.editedExam.SLOT) {
    this.onEditSlotChange();
  }
}

  onEditDayChange() {
if (!this.editedExam || !this.editedExam.DAY) {
    this.availableSlots = [];
    return;
  }

  this.availableSlots = this.timeSlots.filter(slot => {
    const slotKey = `${this.editedExam.DAY}_${slot}`;
    const usedRooms = this.usedRoomsPerSlot[slotKey];

    // If slot is empty or has room for more
    return !usedRooms || usedRooms.size < this.rooms.length;
  });

  this.availableRooms = [];
  console.log(`✓ ${this.availableSlots.length} available slots`);
}
 



  cancelEdit() {

    console.log('✓ Edit cancelled');
    this.editingRow = null;
    this.editedExam = null;
    this.availableSlots = [];
    this.availableRooms = [];
        this.editingExamKey = null; // ← Add this line

  }

  


// saveEdit() {
//   console.log('=== saveEdit called ===');
//   console.log('Editing exam key:', this.editingExamKey);
//   console.log('Edited data:', this.editedExam);

//   // Safety checks
//   if (!this.editingExamKey || !this.editedExam) {
//     console.error('❌ No exam is being edited');
//     this.showToast('Error', 'No exam selected for editing', 'destructive');
//     return;
//   }

//   if (!this.editedExam.DAY || !this.editedExam.SLOT || !this.editedExam.ROOM) {
//     this.showToast('Error', 'Please select Day, Time, and Room', 'destructive');
//     return;
//   }

//   // Find the exam in the ORIGINAL array by key
//   const realIndex = this.generatedSchedule.findIndex(
//     e => this.getExamKey(e) === this.editingExamKey
//   );

//   if (realIndex === -1) {
//     console.error('❌ Exam not found in generatedSchedule');
//     this.showToast('Error', 'Exam not found', 'destructive');
//     return;
//   }

//   console.log('📍 Found exam at real index:', realIndex);

//   const original = this.generatedSchedule[realIndex];

//   // Clear old room usage if schedule changed
//   if (
//     original.DAY !== this.editedExam.DAY ||
//     original.SLOT !== this.editedExam.SLOT ||
//     original.ROOM !== this.editedExam.ROOM
//   ) {
//     console.log('🔄 Schedule changed - updating room tracking');

//     // Remove old room
//     const oldSlots = this.getSlotsArray(original.SLOT);
//     oldSlots.forEach(s => {
//       const key = `${original.DAY}_${s}`;
//       if (this.usedRoomsPerSlot[key]) {
//         this.usedRoomsPerSlot[key].delete(original.ROOM);
//       }
//     });

//     // Add new room
//     const newSlots = this.getSlotsArray(this.editedExam.SLOT);
//     newSlots.forEach(s => {
//       const key = `${this.editedExam.DAY}_${s}`;
//       if (!this.usedRoomsPerSlot[key]) {
//         this.usedRoomsPerSlot[key] = new Set();
//       }
//       this.usedRoomsPerSlot[key].add(this.editedExam.ROOM);
//     });
//   }

//   // Update the exam in the original array
//   this.generatedSchedule[realIndex] = { ...this.editedExam };
//   console.log('✅ Exam updated:', this.generatedSchedule[realIndex]);

//   // Clear edit state
//   this.editingExamKey = null;
//   this.editedExam = null;
//   this.availableSlots = [];
//   this.availableRooms = [];

//   // Rebuild everything
//   this.generateCourseGridData();
//   this.detectProctorConflicts();
//   this.autoSaveToLocalStorage();

//   this.showToast('Success', 'Exam updated');
//   console.log('✓ Save completed');
// }

saveEdit() {
  console.log('=== saveEdit called ===');
  console.log('Editing row:', this.editingRow);
  console.log('Edited data:', this.editedExam);

  // Safety checks
  if (this.editingRow === null || !this.editedExam) {
    console.error('❌ No exam is being edited');
    this.showToast('Error', 'No exam selected for editing', 'destructive');
    return;
  }

  if (!this.editedExam.DAY || !this.editedExam.SLOT || !this.editedExam.ROOM) {
    this.showToast('Error', 'Please select Day, Time, and Room', 'destructive');
    return;
  }

  // Get the original exam from displayedSchedule using the display index
  const displayedExam = this.displayedSchedule[this.editingRow];
  
  if (!displayedExam) {
    console.error('❌ Exam not found in displayedSchedule');
    this.showToast('Error', 'Exam not found', 'destructive');
    return;
  }

  // Find the actual exam(s) in generatedSchedule
  const original = this.generatedSchedule.find(e => 
    e.CODE === displayedExam.CODE &&
    e.SUBJECT_ID === displayedExam.SUBJECT_ID &&
    e.DAY === displayedExam.DAY &&
    e.SLOT === displayedExam.SLOT
  );

  if (!original) {
    console.error('❌ Original exam not found');
    this.showToast('Error', 'Exam not found', 'destructive');
    return;
  }

  // Check if this is a multi-slot exam
  const isMultiSlot = original.IS_MULTI_SLOT;
  const totalSlots = original.TOTAL_SLOTS || 1;

  console.log(`📝 Editing ${isMultiSlot ? 'multi-slot' : 'single-slot'} exam (${totalSlots} slots)`);

  // Clear old room usage for ALL slots of this exam
  if (isMultiSlot) {
    const allOldSlots = this.generatedSchedule.filter(e =>
      e.CODE === original.CODE &&
      e.SUBJECT_ID === original.SUBJECT_ID &&
      e.DAY === original.DAY &&
      e.ROOM === original.ROOM
    );

    allOldSlots.forEach(e => {
      const key = `${e.DAY}_${e.SLOT}`;
      if (this.usedRoomsPerSlot[key]) {
        this.usedRoomsPerSlot[key].delete(e.ROOM);
      }
    });

    // Remove ALL old slot entries
    this.generatedSchedule = this.generatedSchedule.filter(e =>
      !(e.CODE === original.CODE &&
        e.SUBJECT_ID === original.SUBJECT_ID &&
        e.DAY === original.DAY &&
        e.ROOM === original.ROOM)
    );
  } else {
    // Single slot: clear old room
    const key = `${original.DAY}_${original.SLOT}`;
    if (this.usedRoomsPerSlot[key]) {
      this.usedRoomsPerSlot[key].delete(original.ROOM);
    }
  }

  // Add new entries
  if (isMultiSlot) {
    // Multi-slot: Add entries for all slots
    const newSlotIndex = this.timeSlots.indexOf(this.editedExam.SLOT);
    
    if (newSlotIndex === -1) {
      this.showToast('Error', 'Invalid time slot', 'destructive');
      return;
    }

    if (newSlotIndex + totalSlots > this.timeSlots.length) {
      this.showToast('Error', 'Not enough consecutive slots available', 'destructive');
      return;
    }

    for (let i = 0; i < totalSlots; i++) {
      const slot = this.timeSlots[newSlotIndex + i];
      const key = `${this.editedExam.DAY}_${slot}`;
      
      if (!this.usedRoomsPerSlot[key]) {
        this.usedRoomsPerSlot[key] = new Set();
      }
      this.usedRoomsPerSlot[key].add(this.editedExam.ROOM);

      this.generatedSchedule.push({
        ...this.editedExam,
        SLOT: slot,
        SLOT_INDEX: i,
        TOTAL_SLOTS: totalSlots,
        IS_MULTI_SLOT: true
      });
    }

    console.log(`✅ Updated ${totalSlots} slot entries`);
  } else {
    // Single slot: Update entry
    const key = `${this.editedExam.DAY}_${this.editedExam.SLOT}`;
    if (!this.usedRoomsPerSlot[key]) {
      this.usedRoomsPerSlot[key] = new Set();
    }
    this.usedRoomsPerSlot[key].add(this.editedExam.ROOM);

    if (!isMultiSlot) {
      // Replace at original index
      this.generatedSchedule[this.editingRow] = { ...this.editedExam };
    } else {
      // Add as new single entry
      this.generatedSchedule.push({ ...this.editedExam });
    }

    console.log('✅ Updated single slot entry');
  }

  // Clear edit state
  this.editingRow = null;
  this.editedExam = null;
  this.availableSlots = [];
  this.availableRooms = [];

  // Rebuild everything
  this.generateCourseGridData();
  this.detectProctorConflicts();
  this.autoSaveToLocalStorage();

  this.showToast('Success', 'Exam updated');
  console.log('✓ Save completed');
}


getMergedTimeDisplay(exam: ScheduledExam): string {
  if (!exam.IS_MULTI_SLOT) {
    return exam.SLOT;
  }

  // Find all slots for this exam
  const allSlots = this.generatedSchedule
    .filter(e => 
      e.CODE === exam.CODE &&
      e.SUBJECT_ID === exam.SUBJECT_ID &&
      e.DAY === exam.DAY &&
      e.ROOM === exam.ROOM &&
      e.IS_MULTI_SLOT
    )
    .sort((a, b) => (a.SLOT_INDEX || 0) - (b.SLOT_INDEX || 0))
    .map(e => e.SLOT);

  if (allSlots.length <= 1) {
    return exam.SLOT;
  }

  // Merge the time range
  const firstSlot = allSlots[0];
  const lastSlot = allSlots[allSlots.length - 1];

  const startTime = firstSlot.split('-')[0].trim();
  const endTime = lastSlot.split('-')[1].trim();

  return `${startTime} - ${endTime}`;
}



  updateEditField(field: keyof ScheduledExam, value: any) {
    if (this.editedExam) {
      (this.editedExam as any)[field] = value;
    }
  }

 goToStep(step: 'import' | 'generate' | 'summary' | 'timetable' | 'coursegrid' | 'proctor') {
  console.log('Navigating to step:', step);
  
  if (step === 'proctor') {
    // Initialize proctors before showing the view
    this.viewProctorAssignments();
  } else {
    this.currentStep = step;
  }
}

  getDayNumber(day: string): number {
    const match = day.match(/\d+/);
    return match ? parseInt(match[0]) : 0;
  }

  findSafeSlots(title: string, currentDay: string, currentSlot: string): any[] {
    const safeSlots: { day: string; slot: string }[] = [];
    
    const affectedExams = this.generatedSchedule.filter(e => 
      e.DESCRIPTIVE_TITLE.toUpperCase() === title.toUpperCase()
    );
    
    const affectedCourses = new Set(affectedExams.map(e => e.COURSE));

    this.days.forEach(day => {
      this.timeSlots.forEach(slot => {
        if (day === currentDay && slot === currentSlot) return;

        let hasConflict = false;
        affectedCourses.forEach(course => {
          const examsInSlot = this.generatedSchedule.filter(e => 
            e.DAY === day && e.SLOT === slot && e.COURSE === course
          );
          if (examsInSlot.length > 0) hasConflict = true;
        });

        if (!hasConflict) {
          safeSlots.push({ day, slot });
        }
      });
    });

    return safeSlots;
  }

  updateExamByTitle(title: string, newDay: string, newSlot: string) {
    this.generatedSchedule = this.generatedSchedule.map(exam => {
      if (exam.DESCRIPTIVE_TITLE.toUpperCase() === title.toUpperCase()) {
        return { ...exam, DAY: newDay, SLOT: newSlot };
      }
      return exam;
    });
    
    if (this.currentStep === 'coursegrid') {
      this.generateCourseGridData();
    }
    
    this.showToast('Updated', `All exams with title "${title}" moved to ${newDay} ${newSlot}`);
    this.detectProctorConflicts();
    this.autoSaveToLocalStorage();
  }

  removeExam(exam: any) {
  const index = this.generatedSchedule.findIndex(
    e => e.SUBJECT_ID === exam.SUBJECT_ID && e.CODE === exam.CODE && e.DAY === exam.DAY && e.SLOT === exam.SLOT
  );

  if (index !== -1) {
    this.generatedSchedule.splice(index, 1);
    this.generateCourseGridData(); // refresh grid
  }
}





  isSlotSafeForExam(exam: ScheduledExam, day: string, slot: string) {
    return !this.generatedSchedule.some(e =>
      e.DAY === day &&
      e.SLOT === slot &&
      e.COURSE === exam.COURSE &&
      e.SUBJECT_ID !== exam.SUBJECT_ID
    );
  }

 
//   moveExam(exam: ScheduledExam, newDay: string, newSlot: string) {
//   const index = this.generatedSchedule.findIndex(
//     e => e.SUBJECT_ID === exam.SUBJECT_ID &&
//          e.CODE === exam.CODE &&
//          e.DAY === exam.DAY &&
//          e.SLOT === exam.SLOT
//   );

//   if (index === -1) return;

//   // Clear old room usage
//   const oldSlots = this.getSlotsArray(exam.SLOT);
//   oldSlots.forEach(s => {
//     const key = `${exam.DAY}_${s}`;
//     if (this.usedRoomsPerSlot[key]) {
//       this.usedRoomsPerSlot[key].delete(exam.ROOM);
//     }
//   });

//   // Update day/slot
//   this.generatedSchedule[index].DAY = newDay;
//   this.generatedSchedule[index].SLOT = newSlot;

//   // Map to Exam for room assignment
//   const examForRoom: Exam = {
//     code: exam.CODE,
//     subjectId: exam.SUBJECT_ID,
//     title: exam.DESCRIPTIVE_TITLE,
//     course: exam.COURSE,
//     deptCode: exam.DEPT_SUB,
//     yearLevel: exam.YEAR_LEVEL,
//     instructor: exam.INSTRUCTOR,
//     dept: exam.DEPT,
//     lec: 0,
//     oe: exam.OE || 0,
//     version: ''
//   };

//   // Get new room
//   const newSlots = this.getSlotsArray(newSlot);
//   const newRoom = newSlots.length > 1 
//     ? this.getFreeRoomForMultiSlot(examForRoom, newDay, newSlots, this.rooms)
//     : this.getFreeRoomForSlot(examForRoom, newDay, newSlot, this.rooms);

//   this.generatedSchedule[index].ROOM = newRoom;

//   this.generateCourseGridData();
//   this.detectProctorConflicts();
//   this.autoSaveToLocalStorage();
// }

moveExam(exam: ScheduledExam, newDay: string, newSlot: string) {
  if (exam.IS_MULTI_SLOT) {
    // === MULTI-SLOT EXAM MOVE ===
    
    // Find all entries for this exam
    const allExamSlots = this.generatedSchedule.filter(e =>
      e.CODE === exam.CODE &&
      e.DAY === exam.DAY &&
      e.ROOM === exam.ROOM
    ).sort((a, b) => (a.SLOT_INDEX || 0) - (b.SLOT_INDEX || 0));

    if (allExamSlots.length === 0) {
      this.showToast('Error', 'Exam not found', 'destructive');
      return;
    }

    const totalSlots = exam.TOTAL_SLOTS || allExamSlots.length;
    
    // Get new consecutive slots
    const newSlotIndex = this.timeSlots.indexOf(newSlot);
    if (newSlotIndex === -1) {
      this.showToast('Error', 'Invalid time slot', 'destructive');
      return;
    }

    if (newSlotIndex + totalSlots > this.timeSlots.length) {
      this.showToast('Error', 'Not enough consecutive slots available', 'destructive');
      return;
    }

    const newSlots: string[] = [];
    for (let i = 0; i < totalSlots; i++) {
      newSlots.push(this.timeSlots[newSlotIndex + i]);
    }

    // Check room availability for all new slots
    const availableRooms = this.getAvailableRooms(this.rooms);
    let newRoom = exam.ROOM;
    let roomAvailable = true;

    for (const slot of newSlots) {
      const key = `${newDay}_${slot}`;
      if (!this.usedRoomsPerSlot[key]) {
        this.usedRoomsPerSlot[key] = new Set();
      }
      
      // Check if current room is available in all slots
      if (this.usedRoomsPerSlot[key].has(exam.ROOM)) {
        roomAvailable = false;
        break;
      }
    }

    // If room not available, find a new one
    if (!roomAvailable) {
      const originalExam = this.exams.find(e => e.code === exam.CODE);
    const examForRoom: Exam = {
      code: exam.CODE,
      subjectId: exam.SUBJECT_ID,
      title: exam.DESCRIPTIVE_TITLE,
      course: exam.COURSE,
      deptCode: exam.DEPT_SUB,
      yearLevel: exam.YEAR_LEVEL,
      instructor: exam.INSTRUCTOR,
      dept: exam.DEPT,
      lec: 0,
      lab: 0,
      oe: exam.OE || 0,
      version: '',
      room: (originalExam && originalExam.room) || ''
    };

      newRoom = this.getFreeRoomForMultiSlotSameRoom(examForRoom, newDay, newSlots, availableRooms);
      
      if (!newRoom || newRoom === 'TBD') {
        this.showToast('Error', 'No available room for all slots', 'destructive');
        return;
      }
    }

    // Clear old room usage
    allExamSlots.forEach(oldExam => {
      const key = `${oldExam.DAY}_${oldExam.SLOT}`;
      if (this.usedRoomsPerSlot[key]) {
        this.usedRoomsPerSlot[key].delete(oldExam.ROOM);
      }
    });

    // Remove old entries
    this.generatedSchedule = this.generatedSchedule.filter(e =>
      !(e.CODE === exam.CODE && e.DAY === exam.DAY && e.ROOM === exam.ROOM)
    );

    // Add new entries
    newSlots.forEach((slot, index) => {
      const key = `${newDay}_${slot}`;
      if (!this.usedRoomsPerSlot[key]) {
        this.usedRoomsPerSlot[key] = new Set();
      }
      this.usedRoomsPerSlot[key].add(newRoom);

      this.generatedSchedule.push({
        ...exam,
        DAY: newDay,
        SLOT: slot,
        ROOM: newRoom,
        SLOT_INDEX: index,
        TOTAL_SLOTS: totalSlots
      });
    });

    this.showToast('Success', `Multi-slot exam moved to ${newDay} ${newSlots.join(', ')}`);
    
  } else {
    // === SINGLE SLOT EXAM MOVE (your existing logic) ===
    
    const index = this.generatedSchedule.findIndex(
      e => e.SUBJECT_ID === exam.SUBJECT_ID &&
           e.CODE === exam.CODE &&
           e.DAY === exam.DAY &&
           e.SLOT === exam.SLOT
    );

    if (index === -1) {
      this.showToast('Error', 'Exam not found', 'destructive');
      return;
    }

    // Clear old room usage
    const oldSlots = this.getSlotsArray(exam.SLOT);
    oldSlots.forEach(s => {
      const key = `${exam.DAY}_${s}`;
      if (this.usedRoomsPerSlot[key]) {
        this.usedRoomsPerSlot[key].delete(exam.ROOM);
      }
    });

    // Update day/slot
    this.generatedSchedule[index].DAY = newDay;
    this.generatedSchedule[index].SLOT = newSlot;

    // Map to Exam for room assignment
    const examForRoom: Exam = {
      code: exam.CODE,
      subjectId: exam.SUBJECT_ID,
      title: exam.DESCRIPTIVE_TITLE,
      course: exam.COURSE,
      deptCode: exam.DEPT_SUB,
      yearLevel: exam.YEAR_LEVEL,
      instructor: exam.INSTRUCTOR,
      dept: exam.DEPT,
      lec: 0,
      lab: 0,
      oe: exam.OE || 0,
      version: ''
    };

    // Get new room
    const newSlots = this.getSlotsArray(newSlot);
    const newRoom = newSlots.length > 1 
      ? this.getFreeRoomForMultiSlot(examForRoom, newDay, newSlots, this.rooms)
      : this.getFreeRoomForSlot(examForRoom, newDay, newSlot, this.rooms);

    this.generatedSchedule[index].ROOM = newRoom;
  }

  this.generateCourseGridData();
  this.detectProctorConflicts();
  this.autoSaveToLocalStorage();
}


  hasSavedData(): boolean {
    return !!localStorage.getItem('examScheduleData');
  }

  showRestorePrompt() {
    Swal.fire({
      title: 'Restore Previous Schedule?',
      text: 'We found a saved schedule. Would you like to restore it?',
      type: 'question',
      showCancelButton: true,
      confirmButtonText: 'Yes, restore it',
      cancelButtonText: 'Start fresh'
    }).then((result) => {
      if (result.value) {
        this.loadFromLocalStorage();
      }
    });
  }

  // NEW: Auto-save to local storage
  autoSaveToLocalStorage() {
    const dataToSave = {
      activeTerm: this.activeTerm,
      exams: this.exams,
      rooms: this.rooms,
      generatedSchedule: this.generatedSchedule,
      examDates: this.examDates,
      numberOfDays: this.numberOfDays,
      currentStep: this.currentStep
    };
    localStorage.setItem('examScheduleData', JSON.stringify(dataToSave));
  }

  saveToLocalStorage() {
    this.autoSaveToLocalStorage();
    this.global.swalSuccess("Schedule saved to local storage!");
  }

  loadFromLocalStorage() {
    const saved = localStorage.getItem('examScheduleData');
    if (!saved) {
      this.global.swalAlertError("No saved schedule found.");
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      this.activeTerm = parsed.activeTerm || '';
      this.exams = parsed.exams || [];
      this.rooms = parsed.rooms || [];
      this.generatedSchedule = parsed.generatedSchedule || [];
      this.examDates = parsed.examDates || [''];
      this.numberOfDays = parsed.numberOfDays || 3;
      this.currentStep = parsed.currentStep || 'import';

      this.updateDaysArray();
      this.detectProctorConflicts();
      this.cdr.markForCheck();
      this.global.swalSuccess("Schedule loaded successfully!");
    } catch (err) {
      console.error("Error loading saved schedule:", err);
      this.global.swalAlertError("Failed to load saved schedule.");
    }
  }

  hasExamsForYear(course: string, year: number, day: string): boolean {
    if (!this.courseGridData.grid || !this.courseGridData.grid[day] || !this.courseGridData.grid[day][course]) {
      return false;
    }

    const slots = this.courseGridData.grid[day][course];
    for (let slot in slots) {
      if (slots[slot].some((exam: any) => exam.yearLevel === year)) {
        return true;
      }
    }
    return false;
  }



assignProctors() {
  // 1️⃣ Reset all proctor assignments
  this.generatedSchedule.forEach(exam => exam.PROCTOR = '');
  this.instructorSchedule = {}; // Tracks which instructors are busy per day+slot

  // 2️⃣ Group exams by instructor + day + slot
  const grouped: { [key: string]: any[] } = {};
  this.generatedSchedule.forEach(exam => {
    const key = `${exam.INSTRUCTOR}_${exam.DAY}_${exam.SLOT}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(exam);
  });

  // 3️⃣ Assign main instructor to first exam in each group
  Object.values(grouped).forEach(exams => {
    exams.sort((a, b) => a.CODE.localeCompare(b.CODE)); // Stable order
    const mainExam = exams[0];

    mainExam.PROCTOR = mainExam.INSTRUCTOR;
    this.markInstructorBusy(mainExam.INSTRUCTOR, mainExam.DAY, mainExam.SLOT);

    // Conflicting exams remain blank for substitutes
    for (let i = 1; i < exams.length; i++) {
      exams[i].PROCTOR = '';
    }
  });

  // 4️⃣ Fill in substitutes for blank proctors
  this.generatedSchedule.forEach(exam => {
    if (!exam.PROCTOR) {
      const substitute = this.findAvailableInstructor(exam.DAY, exam.SLOT, exam.INSTRUCTOR);
      if (substitute) {
        exam.PROCTOR = substitute;
        this.markInstructorBusy(substitute, exam.DAY, exam.SLOT);
      }
      // Optional: else, PROCTOR remains blank
    }
  });

  // 5️⃣ Recompute the available proctor list for dropdowns
  this.computeAvailableProctors();
}


// FIXED: Assign proctor button handler
assignProctorButtonClicked(exam: any) {
  if (!exam) return;
  
  console.log('=== Assign Proctor Button Clicked ===');
  
  // Find the actual exam in generatedSchedule
  const examTitle = (exam.DESCRIPTIVE_TITLE || exam.title || '').toUpperCase().trim();
  const examCode = (exam.CODE || exam.code || '').toUpperCase().trim();
  
  const actualExam = this.generatedSchedule.find(e => {
    return (
      (e.CODE && e.CODE.toUpperCase().trim() === examCode) ||
      (e.DESCRIPTIVE_TITLE && e.DESCRIPTIVE_TITLE.toUpperCase().trim() === examTitle)
    );
  });

  if (!actualExam) {
    console.error('Could not find exam');
    return;
  }

  // Initialize if needed
  if (!this.instructorSubjects || this.instructorSubjects.size === 0) {
    this.initializeInstructorData();
  }
  
  // Ensure proctor is set
  this.generatedSchedule.forEach(e => {
    if (!e.PROCTOR || e.PROCTOR === '') {
      e.PROCTOR = e.INSTRUCTOR;
    }
  });
  
  // Clear filters
  this.proctorSearchQuery = '';
  this.selectedProctorDept = '';
  this.selectedSubjectDept = "";
  this.selectedProctorSubject = '';
  
  // Switch view
  this.currentStep = 'proctor';
  
  // Manual change detection
  setTimeout(() => {
    this.cd.detectChanges();
  }, 0);
}
// HELPER: Get full exam object from partial data
// getFullExam(partialExam: any, day: string, slot: string): ScheduledExam | null {
//   const title = (partialExam.DESCRIPTIVE_TITLE || partialExam.title || '').toUpperCase().trim();
//   const code = (partialExam.CODE || partialExam.code || '').toUpperCase().trim();
  
//   return this.generatedSchedule.find(e =>
//     e.DAY === day &&
//     e.SLOT === slot &&
//     (e.DESCRIPTIVE_TITLE.toUpperCase().trim() === title ||
//      e.CODE.toUpperCase().trim() === code)
//   ) || null;
// }

getFullExam(partialExam: any, day: string, slot: string): ScheduledExam | null {
  const title = (partialExam.DESCRIPTIVE_TITLE || partialExam.title || '').toUpperCase().trim();
  const code = (partialExam.CODE || partialExam.code || '').toUpperCase().trim();
  
  const exam = this.generatedSchedule.find(e =>
    e.DAY === day &&
    e.SLOT === slot &&
    (e.DESCRIPTIVE_TITLE.toUpperCase().trim() === title ||
     e.CODE.toUpperCase().trim() === code)
  );

  if (!exam) return null;

  // If it's a multi-slot exam, add info about all slots
  if (exam.IS_MULTI_SLOT) {
    const allSlots = this.generatedSchedule
      .filter(e => e.CODE === exam.CODE && e.DAY === day && e.ROOM === exam.ROOM)
      .sort((a, b) => (a.SLOT_INDEX || 0) - (b.SLOT_INDEX || 0))
      .map(e => e.SLOT);
    
    return {
      ...exam,
      ALL_SLOTS: allSlots
    } as any;
  }
  
  return exam;
}


// Check if instructor is free
isInstructorAvailable(name: string, day: string, slot: string): boolean {
  if (!this.instructorSchedule[name]) return true;
  return !this.instructorSchedule[name].some(s => s.day === day && s.slot === slot);
}

// Mark instructor as busy
markInstructorBusy(name: string, day: string, slot: string) {
  if (!this.instructorSchedule[name]) this.instructorSchedule[name] = [];
  this.instructorSchedule[name].push({ day, slot });
}

// Find a free instructor excluding a specific one
findAvailableInstructor(day: string, slot: string, exclude: string): string | null {
  const allInstructors = Array.from(new Set(this.generatedSchedule.map(e => e.INSTRUCTOR)));
  for (const instr of allInstructors) {
    if (instr !== exclude && this.isInstructorAvailable(instr, day, slot)) {
      return instr;
    }
  }
  return null;
}


// returns a list of unique instructors for a given department/course
getInstructorsByCourse(courseCode: string): string[] {
  const instructors = new Set<string>();
  this.generatedSchedule.forEach(exam => {
    if (exam.CODE && exam.CODE.startsWith(courseCode) && exam.INSTRUCTOR) {

      instructors.add(exam.INSTRUCTOR);
    }
  });
  const result = Array.from(instructors).sort();
  return result.length ? result : ['No instructor available'];
}

// Initialize PROCTOR for all exams
initializeProctors() {
  this.generatedSchedule.forEach(exam => {
    if (!exam.PROCTOR) exam.PROCTOR = 'TBD';
  });
}




// Check if instructor is busy
isInstructorBusy(name: string, day: string, slot: string) {
  return !!this.generatedSchedule.find(e => e.DAY === day && e.SLOT === slot && e.PROCTOR === name);
}



availableProctorsMap: { [key: string]: string[] } = {};

computeAvailableProctors() {
  this.generatedSchedule.forEach(exam => {
    const key = `${exam.CODE}_${exam.DAY}_${exam.SLOT}`;
    this.availableProctorsMap[key] = this.calculateAvailableProctors(exam);
  });
}


calculateAvailableProctors(exam: any): string[] {
  const available = new Set<string>();

  const allInstructors = Array.from(new Set(
    this.generatedSchedule.map(e => e.INSTRUCTOR)
  ));

  allInstructors.forEach(instr => {
    if (instr === exam.INSTRUCTOR) return;

    if (!this.isInstructorBusy(instr, exam.DAY, exam.SLOT)) {
      available.add(instr);
    }
  });

  const sorted = Array.from(available).sort();
  return sorted.length ? sorted : ['No available instructor'];
}



// 2. FIXED: Initialize proctor assignments (called when going to proctor step)
initializeProctorAssignments() {
  console.log('Initializing proctor assignments...');
  
  // Step 1: Set default proctor to instructor for all exams
  this.generatedSchedule.forEach(exam => {
    if (!exam.PROCTOR) {
      exam.PROCTOR = exam.INSTRUCTOR;
    }
  });

  // Step 2: Detect conflicts
  this.detectAndResolveProctorConflicts();
  
  // Step 3: Compute available proctors for dropdowns
  this.computeAvailableProctorsForAll();
  
  console.log('Proctor initialization complete');
}


// 10. FIXED: Download proctor assignments CSV
downloadProctorAssignmentsCSV() {
  if (this.generatedSchedule.length === 0) return;

  const headers = ['Day', 'Time', 'Room', 'Exam Code', 'Subject', 'Course', 'Year', 'Instructor', 'Assigned Proctor', 'Has Conflict'];
  const rows = this.generatedSchedule.map(item => [
    item.DAY,
    item.SLOT,
    item.ROOM,
    item.CODE,
    item.DESCRIPTIVE_TITLE,
    item.COURSE,
    item.YEAR_LEVEL,
    item.INSTRUCTOR,
    item.PROCTOR || 'Not Assigned',
    item.HAS_CONFLICT ? 'Yes' : 'No'
  ]);

  let csv = headers.join(',') + '\n';
  rows.forEach(row => {
    csv += row.map(cell => `"${cell}"`).join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  saveAs(blob, 'proctor_assignments.csv');
  this.showToast('Downloaded', 'Proctor assignments exported successfully');
}

// 11. FIXED: Remove exam (for proctor view)
removeExamFromProctorView(exam: ScheduledExam) {
  Swal.fire({
    title: 'Remove Exam?',
    text: `Remove ${exam.CODE} - ${exam.DESCRIPTIVE_TITLE}?`,
    type: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#3085d6',
    confirmButtonText: 'Yes, remove it!',
    cancelButtonText: 'Cancel'
  }).then((result) => {
    if (result.value) {
      const index = this.generatedSchedule.findIndex(e => 
        e.CODE === exam.CODE &&
        e.DAY === exam.DAY &&
        e.SLOT === exam.SLOT
      );
      
      if (index !== -1) {
        this.generatedSchedule.splice(index, 1);
        this.showToast('Removed', 'Exam removed successfully');
        this.computeAvailableProctorsForAll();
        this.autoSaveToLocalStorage();
        this.cd.detectChanges();
      }
    }
  });
}

// 12. FIXED: Move exam (for proctor view)
moveExamFromProctorView(exam: ScheduledExam) {
  // Find safe slots for this exam
  const safeSlots = this.findSafeSlotsForSingleExam(exam);
  
  if (safeSlots.length === 0) {
    this.showToast('No Slots Available', 'No conflict-free slots found for this exam', 'warning');
    return;
  }
  
  // Show move dialog
  this.moveExamData = { examRef: exam, groupExams: [exam] };
  this.safeSlots = safeSlots;
  this.movePopupVisible = true;
  this.cd.detectChanges();
}

// 13. FIXED: Find safe slots for a single exam
findSafeSlotsForSingleExam(exam: ScheduledExam): SafeSlotOption[] {
  const safe: SafeSlotOption[] = [];
  const roomsList = this.rooms.length > 0 ? this.rooms : ['A', 'C', 'K', 'L', 'M', 'N'];

  for (let day of this.days) {
    for (let slot of this.timeSlots) {
      // Skip current slot
      if (day === exam.DAY && slot === exam.SLOT) continue;
      
      // Check if this slot is safe (no course conflict)
      const hasConflict = this.generatedSchedule.some(e =>
        e !== exam &&
        e.DAY === day &&
        e.SLOT === slot &&
        e.COURSE === exam.COURSE
      );
      
      if (!hasConflict) {
        // Find available rooms
        const usedRooms = new Set(
          this.generatedSchedule
            .filter(e => e !== exam && e.DAY === day && e.SLOT === slot)
            .map(e => e.ROOM)
        );
        
        const availableRooms = roomsList.filter(r => !usedRooms.has(r));
        
        if (availableRooms.length > 0) {
          safe.push({ day, slot, availableRooms });
        }
      }
    }
  }

  return safe;
}


testMethods() {
  console.log('removeExamFromGrid exists:', typeof this.removeExamFromGrid === 'function');
  console.log('moveExamFromGrid exists:', typeof this.moveExamFromGrid === 'function');
  console.log('viewProctorAssignments exists:', typeof this.viewProctorAssignments === 'function');
  console.log('Generated schedule:', this.generatedSchedule.length);
  console.log('Days:', this.days);
  console.log('Rooms:', this.rooms);
}

// This will filter courses by course, year, and search query
filteredCoursesByCourseAndYear() {
  if (!this.courseGridData || !this.courseGridData.courses) return [];

const searchLower = this.searchQuery ? this.searchQuery.toLowerCase() : '';

  return this.courseGridData.courses
    .filter(courseObj => {
      // Filter by selected course
      if (this.selectedCourseFilter && courseObj.course !== this.selectedCourseFilter) return false;
      return true;
    })
    .map(courseObj => {
      const filteredYears = (courseObj.years || []).filter(yearObj => {
        // Filter by selected year
        if (this.selectedYearFilter && yearObj.year !== this.selectedYearFilter) return false;

          // Filter exams inside slots based on searchQuery
          if (searchLower) {
            const newSlots: { [key: string]: any[] } = {};
          Object.keys(yearObj.slots || {}).forEach(slotKey => {
            const exams = yearObj.slots[slotKey] || [];
            newSlots[slotKey] = exams.filter(exam => {
              const subjectId = (exam.subjectId || exam.SUBJECT_ID || '').toLowerCase();
              const title = (exam.title || exam.DESCRIPTIVE_TITLE || '').toLowerCase();
              return subjectId.includes(searchLower) || title.includes(searchLower);
            });
          });
          yearObj.slots = newSlots;
        }

        return true;
      });

      return {
        course: courseObj.course,
        years: filteredYears
      };
    })
    .filter(courseObj => courseObj.years.length > 0); // remove empty courses
}



getAllDepartments() {
  const departments = new Set<string>();

  if (!this.courseGridData || !this.courseGridData.courses) return [];

  this.courseGridData.courses.forEach(courseObj => {
    (courseObj.years || []).forEach(yearObj => {
      Object.keys(yearObj.slots || {}).forEach(slotKey => {
        const exams = yearObj.slots[slotKey] || [];

        exams.forEach(exam => {
          const dept = (exam.dept || exam.DEPT || '').trim();
          if (dept) departments.add(dept);  // add to set to avoid duplicates
        });
      });
    });
  });

  return Array.from(departments);
}


// Find a substitute proctor for a given exam and day|slot
findSubstituteProctor(exam: ScheduledExam, key: string): string | null {
  const [day, slot] = key.split('|');
  const takenProctors = new Set(
    this.generatedSchedule
      .filter(e => e.DAY === day && e.SLOT === slot && e.PROCTOR)
      .map(e => e.PROCTOR ? e.PROCTOR.toUpperCase().trim() : '')
  );

  const allProctors = this.uniqueProctors.map(p => p.toUpperCase().trim());
  const substitute = allProctors.find(p => !takenProctors.has(p));
  return substitute || null;
}


// 3. FIXED: Detect and resolve conflicts
detectAndResolveProctorConflicts() {
  console.log('Detecting proctor conflicts...');
  
  const examsByDaySlot: { [key: string]: ScheduledExam[] } = {};
  
  this.generatedSchedule.forEach(exam => {
    const key = `${exam.DAY}|${exam.SLOT}`;
    if (!examsByDaySlot[key]) {
      examsByDaySlot[key] = [];
    }
    examsByDaySlot[key].push(exam);
  });

  let totalConflicts = 0;

  Object.entries(examsByDaySlot).forEach(([key, examsInSlot]) => {
    const proctorCount: { [proctor: string]: ScheduledExam[] } = {};
    
    examsInSlot.forEach(exam => {
      const proctor = (exam.PROCTOR || exam.INSTRUCTOR || '').toUpperCase().trim();
      if (proctor) {
        if (!proctorCount[proctor]) {
          proctorCount[proctor] = [];
        }
        proctorCount[proctor].push(exam);
      }
    });

    Object.entries(proctorCount).forEach(([proctor, conflictedExams]) => {
      if (conflictedExams.length > 1) {
        console.log(`Conflict: ${proctor} → ${conflictedExams.length} exams at ${key}`);
        totalConflicts += conflictedExams.length - 1;
        
        const ownClass = conflictedExams.find(e => 
          e.INSTRUCTOR.toUpperCase().trim() === proctor
        );
        
        if (ownClass) {
          ownClass.PROCTOR = ownClass.INSTRUCTOR;
          ownClass.HAS_CONFLICT = false;
        }
        
        conflictedExams.forEach(exam => {
          if (exam !== ownClass) {
            const substitute = this.findSubstituteProctor(exam, key);
            
            if (substitute) {
              exam.PROCTOR = substitute;
              exam.HAS_CONFLICT = false;
              console.log(`✓ Substitute: ${substitute} → ${exam.CODE}`);
            } else {
              exam.HAS_CONFLICT = true;
              console.warn(`✗ No substitute for ${exam.CODE}`);
            }
          }
        });
      } else {
        conflictedExams[0].HAS_CONFLICT = false;
      }
    });
  });
  
  console.log(`Total conflicts: ${totalConflicts}`);
}

// 4. FIXED: Compute available proctors for all
computeAvailableProctorsForAll() {
  this.availableProctorsMap = {};
  
  this.generatedSchedule.forEach(exam => {
    const key = `${exam.CODE}_${exam.DAY}_${exam.SLOT}`;
    this.availableProctorsMap[key] = this.calculateAvailableProctorsForExam(exam);
  });
  
  console.log('Available proctors computed');
}

// 5. FIXED: Calculate available proctors for exam
calculateAvailableProctorsForExam(exam: ScheduledExam): string[] {
  const available: string[] = [];
  
  const allInstructors = Array.from(new Set(
    this.generatedSchedule.map(e => e.INSTRUCTOR.toUpperCase().trim())
  )).sort();
  
  allInstructors.forEach(instructor => {
    const isBusy = this.generatedSchedule.some(e => 
      e !== exam &&
      e.DAY === exam.DAY &&
      e.SLOT === exam.SLOT &&
      e.PROCTOR &&
      e.PROCTOR.toUpperCase().trim() === instructor
    );
    
    if (!isBusy) {
      available.push(instructor);
    }
  });
  
  return available.length > 0 ? available : ['No available instructor'];
}

// 6. FIXED: Get available proctors (for dropdown)
getAvailableProctors(exam: ScheduledExam): string[] {
  const key = `${exam.CODE}_${exam.DAY}_${exam.SLOT}`;
  
  if (this.availableProctorsMap && this.availableProctorsMap[key]) {
    return this.availableProctorsMap[key];
  }
  
  return this.calculateAvailableProctorsForExam(exam);
}

// 7. FIXED: Assign proctor
assignProc(exam: ScheduledExam, proctor: string) {
  console.log('Assigning:', proctor, '→', exam.CODE);
  
  if (!proctor || proctor === 'No available instructor') {
    this.showToast('Error', 'Please select a valid proctor', 'destructive');
    return;
  }
  
  const conflict = this.generatedSchedule.find(e => 
    e !== exam &&
    e.DAY === exam.DAY &&
    e.SLOT === exam.SLOT &&
    e.PROCTOR &&
    e.PROCTOR.toUpperCase().trim() === proctor.toUpperCase().trim()
  );
  
  if (conflict) {
    Swal.fire({
      title: 'Conflict Warning',
      html: `
        <p>${proctor} is already proctoring:</p>
        <p style="margin-top: 10px;"><strong>${conflict.CODE}</strong> - ${conflict.DESCRIPTIVE_TITLE}</p>
        <p style="margin-top: 15px; color: #ef4444;">Assign anyway?</p>
      `,
      type: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, assign anyway',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#ef4444'
    }).then((result) => {
      if (result.value) {
        exam.PROCTOR = proctor;
        exam.HAS_CONFLICT = false;
        this.showToast('Assigned', `${proctor} → ${exam.CODE}`);
        this.autoSaveToLocalStorage();
        this.cd.detectChanges();
      }
    });
  } else {
    exam.PROCTOR = proctor;
    exam.HAS_CONFLICT = false;
    this.showToast('Assigned', `${proctor} → ${exam.CODE}`);
    this.autoSaveToLocalStorage();
    this.cd.detectChanges();
  }
}


viewCourseGrid() {
  console.log('Viewing course grid...');
  this.generateCourseGridData();
  this.currentStep = 'coursegrid';
  this.cd.detectChanges();
}


// 13. FIXED: Remove exam from grid
removeExamFromGrid(exam: any, day: string, slot: string) {
  console.log('=== Removing Exam from Grid ===');
  console.log('Exam:', exam);
  console.log('Day:', day, 'Slot:', slot);
  
  const code = exam.CODE || exam.code;
  const subjectId = exam.SUBJECT_ID || exam.subjectId;
  const title = exam.DESCRIPTIVE_TITLE || exam.title;
  
  Swal.fire({
    title: 'Remove Exam?',
    html: `
      <div style="text-align: left; padding: 10px;">
        <p><strong>Code:</strong> ${code}</p>
        <p><strong>Subject:</strong> ${subjectId}</p>
        <p><strong>Title:</strong> ${title}</p>
        <p><strong>Day:</strong> ${day}</p>
        <p><strong>Time:</strong> ${slot}</p>
      </div>
      <p style="color: #ef4444; margin-top: 15px;">Remove this exam?</p>
    `,
    type: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    confirmButtonText: 'Yes, remove it!'
  }).then((result) => {
    if (result.value) {
      const index = this.generatedSchedule.findIndex(e =>
        e.CODE === code &&
        e.SUBJECT_ID === subjectId &&
        e.DAY === day &&
        e.SLOT === slot
      );
      
      if (index !== -1) {
        this.generatedSchedule.splice(index, 1);
        console.log('✓ Exam removed');
        
        this.generateCourseGridData();
        this.autoSaveToLocalStorage();
        this.showToast('Removed', 'Exam removed successfully', 'success');
        this.cd.detectChanges();
      } else {
        console.error('✗ Exam not found');
        this.showToast('Error', 'Exam not found', 'destructive');
      }
    }
  });
}

// 14. FIXED: Move exam from grid
moveExamFromGrid(exam: any, currentDay: string, currentSlot: string) {
  console.log('=== Moving Exam from Grid ===');
  console.log('Exam:', exam);
  console.log('Current:', currentDay, currentSlot);
  
  const code = exam.CODE || exam.code;
  const subjectId = exam.SUBJECT_ID || exam.subjectId;
  
  const actualExam = this.generatedSchedule.find(e =>
    e.CODE === code &&
    e.SUBJECT_ID === subjectId &&
    e.DAY === currentDay &&
    e.SLOT === currentSlot
  );
  
  if (!actualExam) {
    console.error('✗ Exam not found in schedule');
    this.showToast('Error', 'Exam not found', 'destructive');
    return;
  }
  
  console.log('✓ Found exam:', actualExam.CODE);
  
  const group = this.generatedSchedule.filter(e => {
    const eSub = (e.SUBJECT_ID || '').toUpperCase().trim();
    const examSub = (actualExam.SUBJECT_ID || '').toUpperCase().trim();
    return eSub === examSub;
  });
  
  console.log('Group size:', group.length);
  
  const safeSlots = this.findSafeSlotsForGroup(group);
  console.log('Safe slots:', safeSlots.length);
  
  if (safeSlots.length === 0) {
    Swal.fire({
      title: 'No Available Slots',
      html: `
        <p>No conflict-free slots available for:</p>
        <p style="margin-top: 10px;"><strong>${actualExam.DESCRIPTIVE_TITLE}</strong></p>
        <p>Course: ${actualExam.COURSE}</p>
      `,
      type: 'warning'
    });
    return;
  }
  
  this.moveExamData = { examRef: actualExam, groupExams: group };
  this.safeSlots = safeSlots;
  this.movePopupVisible = true;
  this.cd.detectChanges();
}

// 15. FIXED: Find safe slots for group
findSafeSlotsForGroup(group: ScheduledExam[]): SafeSlotOption[] {
  const safe: SafeSlotOption[] = [];
  const roomsList = this.rooms.length > 0 ? this.rooms : ['A', 'C', 'K', 'L', 'M', 'N'];
  
  console.log('Finding safe slots for', group.length, 'exams');

  for (let day of this.days) {
    for (let slot of this.timeSlots) {
      let safeForAll = true;

      for (let exam of group) {
        const hasConflict = this.generatedSchedule.some(e =>
          !group.includes(e) &&
          e.DAY === day &&
          e.SLOT === slot &&
          e.COURSE.toUpperCase().trim() === exam.COURSE.toUpperCase().trim()
        );
        
        if (hasConflict) {
          safeForAll = false;
          break;
        }
      }

      if (safeForAll) {
        const usedRooms = new Set(
          this.generatedSchedule
            .filter(e => !group.includes(e) && e.DAY === day && e.SLOT === slot)
            .map(e => e.ROOM)
        );

        const availableRooms = roomsList.filter(r => !usedRooms.has(r));
        
        if (availableRooms.length >= group.length) {
          safe.push({ day, slot, availableRooms: availableRooms.slice(0, group.length) });
        }
      }
    }
  }
  
  console.log('Found', safe.length, 'safe slots');
  return safe;
}



// ADD: Helper method to safely initialize move operation
initiateMoveOperation(exam: ScheduledExam) {
  // Find all exams with same subject+title+code (exact match for moving together)
  const groupExams = this.generatedSchedule.filter(e => 
    e.SUBJECT_ID === exam.SUBJECT_ID &&
    e.DESCRIPTIVE_TITLE === exam.DESCRIPTIVE_TITLE &&
    e.CODE === exam.CODE
  );

  if (groupExams.length === 0) {
    this.showToast('Error', 'Exam not found in schedule', 'destructive');
    return;
  }

  this.moveExamData = {
    exam: exam,
    groupExams: groupExams
  };

  // Calculate safe slots (slots where there's no conflict for this course)
  this.calculateSafeSlots(exam.COURSE);
  
  this.movePopupVisible = true;
  console.log(`📦 Moving ${groupExams.length} exam(s):`, groupExams.map(e => e.CODE));
}




// RESTRICTED ROOMS - These rooms cannot be used for exams
private restrictedRooms: string[] = [
  'B-11', 'B-12', 'BTL', 'BUL', 'HL',
  'J-42', 'J-43', 'J-44', 'J-45', 'J-46', 'J-48',
  'K-13', 'K-14', 'K-22', 'K-24', 'K-41',
  'L-23', 'M-21', 'M-31', 'M-33', 'M-43',
  'MChem', 'MLab1', 'MLab2', 'NutriS', 'MTL',
  'A-102', 'A-203', 'A-204', 'A-205', 'A-219', 'A-221',
  'A-225', 'A-226', 'A-234', 'A-302', 'A-306', 'A-308',
  'A-309', 'A-310', 'A-311', 'A-312', 'EMC', 'Hosp', 'Molec', 'Nutri', 
  'Pharm', 'SMTL', 'TBA', 'Virtu', 'to be', 'BTL', 'BUL', 'DemoR', 'TBD'

];

// Helper: Filter out restricted rooms
private getAvailableRooms(roomsList: string[]): string[] {
  return roomsList.filter(room => 
    !this.restrictedRooms.includes(room.trim())
  );
}



generateCourseGridData() {
  console.log('=== Generating Course Grid Data ===');

  const uniqueCourses = Array.from(new Set(this.generatedSchedule.map(e => e.COURSE))).sort();
  const uniqueDays = Array.from(new Set(this.generatedSchedule.map(e => e.DAY)));

  const grid: any = {};

  // Initialize empty grid
  uniqueDays.forEach(day => {
    grid[day] = {};
    uniqueCourses.forEach(course => {
      grid[day][course] = {};
      this.timeSlots.forEach(slot => {
        grid[day][course][slot] = [];
      });
    });
  });

  // Populate grid
  this.generatedSchedule.forEach(exam => {
    const normalizedCourse = exam.COURSE.trim();
    const slotCount = exam.durationHours / (this.SLOT_HOUR || 1) || 1; // Determine number of slots
    const startSlotIndex = this.timeSlots.indexOf(exam.SLOT);

    for (let i = 0; i < slotCount; i++) {
      const slotKey = this.timeSlots[startSlotIndex + i];
      if (!slotKey) continue; // Skip if slot exceeds timeSlots array

      if (!grid[exam.DAY][normalizedCourse][slotKey]) grid[exam.DAY][normalizedCourse][slotKey] = [];

      grid[exam.DAY][normalizedCourse][slotKey].push({
        CODE: exam.CODE,
        SUBJECT_ID: exam.SUBJECT_ID,
        DESCRIPTIVE_TITLE: exam.DESCRIPTIVE_TITLE,
        COURSE: exam.COURSE,
        YEAR_LEVEL: exam.YEAR_LEVEL,
        ROOM: exam.ROOM,
        DEPT: exam.DEPT,
        INSTRUCTOR: exam.INSTRUCTOR,
        PROCTOR: exam.PROCTOR,
        HAS_CONFLICT: exam.HAS_CONFLICT,
        SLOT: slotKey,
        SLOT_INDEX: i,       // 0 = first slot, 1 = second slot, etc.
        TOTAL_SLOTS: slotCount,
        IS_MULTI_SLOT: slotCount > 1,

        // lowercase for backward compatibility
        code: exam.CODE,
        subjectId: exam.SUBJECT_ID,
        title: exam.DESCRIPTIVE_TITLE,
        room: exam.ROOM,
        dept: exam.DEPT,
        yearLevel: exam.YEAR_LEVEL || 1
      });
    }
  });

  // Sort exams in each slot by year level
  uniqueDays.forEach(day => {
    uniqueCourses.forEach(course => {
      this.timeSlots.forEach(slot => {
        if (grid[day][course][slot]) {
          grid[day][course][slot].sort((a: any, b: any) =>
            (a.YEAR_LEVEL || a.yearLevel) - (b.YEAR_LEVEL || b.yearLevel)
          );
        }
      });
    });
  });

  this.courseGridData = { grid, courses: uniqueCourses, days: uniqueDays };
  console.log('✓ Course grid generated');

  return { grid, courses: uniqueCourses, days: uniqueDays };
}




generateExamSchedule() {
  if (this.exams.length === 0) {
    this.showToast('Error', 'Please import exams first', 'destructive');
    return;
  }

  const allRooms = this.rooms.length > 0 ? this.rooms.sort() : ['A', 'C', 'K', 'L', 'M', 'N'];
  const roomsList = this.getAvailableRooms(allRooms);
  
  console.log(`📍 Available rooms (${roomsList.length}):`, roomsList);
  console.log(`🚫 Restricted rooms (${this.restrictedRooms.length}):`, this.restrictedRooms);
  
  const schedule: ScheduledExam[] = [];
  this.usedRoomsPerSlot = {};

  // Group exams by course
  const courseGroups: { [course: string]: Exam[] } = {};
  this.exams.forEach(exam => {
    const course = exam.course ? exam.course.toUpperCase().trim() : '';
    if (!courseGroups[course]) courseGroups[course] = [];
    courseGroups[course].push(exam);
  });

  // Track already scheduled exams by subject+title
  const subjectTitleSlot: { 
    [key: string]: { 
      day: string; 
      slots: string[]; 
      room: string; 
      codes: Set<string> 
    } 
  } = {};
  
  const subjectTitleCodeSlot: { [key: string]: boolean } = {};
  const examsPerDay: { [day: string]: number } = {};
  this.days.forEach(day => examsPerDay[day] = 0);

  const courseSlotsByDay: { [course: string]: { [day: string]: Set<string> } } = {};
  let globalSlotIndex = 0;
  const lastDay = this.days[this.days.length - 1];

  for (const course of Object.keys(courseGroups)) {
    const courseExams = courseGroups[course];
    
    console.log(`\n📚 Processing course: ${course} (${courseExams.length} exams)`);

    // ⭐ NEW: Count sections per subject (subjectId + title)
    const subjectSectionCount: { [key: string]: number } = {};
    courseExams.forEach(exam => {
      const subjectId = exam.subjectId ? exam.subjectId.toUpperCase().trim() : '';
      const title = exam.title ? exam.title.toUpperCase().trim() : '';
      const subjectKey = `${subjectId}_${title}`;
      subjectSectionCount[subjectKey] = (subjectSectionCount[subjectKey] || 0) + 1;
    });

    // ⭐ NEW: Sort exams by section count (most sections first)
    const sortedExams = [...courseExams].sort((a, b) => {
    
      const subjA = a.subjectId ? a.subjectId.toUpperCase().trim() : '';
const titleA = a.title ? a.title.toUpperCase().trim() : '';
const keyA = `${subjA}_${titleA}`;

const subjB = b.subjectId ? b.subjectId.toUpperCase().trim() : '';
const titleB = b.title ? b.title.toUpperCase().trim() : '';
const keyB = `${subjB}_${titleB}`; 

      const countA = subjectSectionCount[keyA] || 0;
      const countB = subjectSectionCount[keyB] || 0;
      
      // Sort by count descending (most sections first)
      if (countA !== countB) return countB - countA;
      
      // If same count, sort alphabetically
      return keyA.localeCompare(keyB);
    });

    console.log('📊 Subject priority order:');
    const loggedSubjects = new Set<string>();
    sortedExams.forEach(exam => {
const subj = exam.subjectId ? exam.subjectId.toUpperCase().trim() : '';
const title = exam.title ? exam.title.toUpperCase().trim() : '';
const subjectKey = `${subj}_${title}`;

if (!loggedSubjects.has(subjectKey)) {
        console.log(`  ${subjectKey}: ${subjectSectionCount[subjectKey]} sections`);
        loggedSubjects.add(subjectKey);
      }
    });

    // Initialize tracking for this course
    if (!courseSlotsByDay[course]) {
      courseSlotsByDay[course] = {};
      this.days.forEach(day => {
        courseSlotsByDay[course][day] = new Set<string>();
      });
    }

    for (const exam of sortedExams) {
      const subjectId = exam.subjectId ? exam.subjectId.toUpperCase().trim() : '';
      const title = exam.title ? exam.title.toUpperCase().trim() : '';
      const code = exam.code ? exam.code.toUpperCase().trim() : '';
      
      const subjectTitleCodeKey = `${subjectId}_${title}_${code}`;
      const subjectTitleKey = `${subjectId}_${title}`;

      if (subjectTitleCodeSlot[subjectTitleCodeKey]) {
        console.log(`⏭️ Skipping duplicate: ${code}`);
        continue;
      }

      const totalUnits = (exam.lec || 0) + (exam.lab || 0);
      const slotsNeeded = totalUnits >= 6 ? 2 : 1;

      // ⭐ NEW: Check instructor classification for time restrictions
const instructorStatus = exam.instructorClassificationStatus ? exam.instructorClassificationStatus.toUpperCase().trim() : '';
      const isPartTime = instructorStatus.includes('PART TIME') || instructorStatus.includes('PART-TIME');

      let day = '';
      let slots: string[] = [];
      let assignedRoom = '';

      if (subjectTitleSlot[subjectTitleKey]) {
  // Same subject EXISTS - but check if there's ROOM first
  const existing = subjectTitleSlot[subjectTitleKey];
  
  // ⭐ CHECK: How many rooms are used in that slot?
  const firstSlot = existing.slots[0];
  const slotKey = `${existing.day}_${firstSlot}`;
  
  if (!this.usedRoomsPerSlot[slotKey]) {
    this.usedRoomsPerSlot[slotKey] = new Set();
  }
  
  const roomsUsed = this.usedRoomsPerSlot[slotKey].size;
  const roomsAvailable = roomsList.length - roomsUsed;
  
  // ✅ If there are at least 3 rooms free, group with existing
  if (roomsAvailable >= 3) {
    day = existing.day;
    slots = [...existing.slots];
    assignedRoom = '';
    
    console.log(`📌 Grouping ${code} with existing ${Array.from(existing.codes).join(', ')} on ${day} ${slots.join(',')} (${roomsUsed}/${roomsList.length} rooms used)`);
    existing.codes.add(code);
    
  } else {
    // ⚠️ SLOT IS FULL - Start a new group in a different slot
    console.warn(`⚠️ ${code}: Cannot group with ${subjectTitleKey} - slot full (${roomsUsed}/${roomsList.length} rooms)`);
    console.log(`🔄 ${code}: Creating overflow group for ${subjectTitleKey}`);
    
    // Treat this as a NEW subject to find a different slot
    // (fall through to the NEW SUBJECT logic below)
    
    // But first, create a NEW tracking entry so future sections can group with THIS one
    const overflowKey = `${subjectTitleKey}_OVERFLOW_${day}_${firstSlot}`;
    // Don't use the existing slot - let it find a new one below
  }
  
} else {
        // NEW SUBJECT - assign schedule
        let sortedDays = [...this.days].sort((a, b) => 
          examsPerDay[a] - examsPerDay[b]
        );
        
        let foundSafeSlot = false;
        let bestDay = '';
        let bestSlots: string[] = [];
        
       
        for (const candidateDay of sortedDays) {
  let availableSlots = [...this.timeSlots];
  
  // ⏰ Part-time instructor restriction
  if (isPartTime) {
    const partTimeStartIndex = this.timeSlots.findIndex(s => s.startsWith('1:30') || s.startsWith('1:00'));
    if (partTimeStartIndex !== -1) {
      availableSlots = this.timeSlots.slice(partTimeStartIndex);
      console.log(`⏰ Part-time instructor ${exam.instructor} - restricted to slots: ${availableSlots.join(', ')}`);
    }
  }

  // 📚 Allied course restriction
  const sectionCount = subjectSectionCount[subjectTitleKey] || 1;
  const isAlliedCourse = sectionCount > 1;
  if (isAlliedCourse) {
    availableSlots = availableSlots.filter(t => !t.startsWith('7:30'));
    console.log(`📚 Allied course ${subjectId} (${sectionCount} sections) - no 7:30 AM slot`);
  }
  
  // 🌅 Last day morning-only restriction
  if (candidateDay === lastDay) {
    availableSlots = this.getMorningSlots(availableSlots);
    if (availableSlots.length === 0) {
      console.warn(`⚠️ No morning slots on last day for ${code}, trying other days`);
      continue;
    }
  }
  
  // Find non-consecutive slots WITH room availability check
  const usedSlots = courseSlotsByDay[course][candidateDay];
  const safeSlots: string[] = [];
  
  for (const slot of availableSlots) {
    const slotIdx = this.timeSlots.indexOf(slot);
    let isSafe = true;
    
    // ✅ CHECK 1: Non-consecutive
    for (let offset = 0; offset < slotsNeeded; offset++) {
      const checkSlot = this.timeSlots[slotIdx + offset];
      if (!checkSlot) {
        isSafe = false;
        break;
      }
      
      if (this.isSlotConsecutiveToAny(checkSlot, usedSlots)) {
        isSafe = false;
        break;
      }
    }
    
    if (isSafe && slotIdx > 0) {
      const slotBefore = this.timeSlots[slotIdx - 1];
      if (usedSlots.has(slotBefore)) {
        isSafe = false;
      }
    }
    
    if (isSafe && slotIdx + slotsNeeded < this.timeSlots.length) {
      const slotAfter = this.timeSlots[slotIdx + slotsNeeded];
      if (usedSlots.has(slotAfter)) {
        isSafe = false;
      }
    }
    
    // ⭐ CHECK 2: Room availability (NEW!)
    if (isSafe) {
      // Check room availability for all needed slots
      let roomsAvailable = true;
      
      for (let i = 0; i < slotsNeeded; i++) {
        const checkSlot = this.timeSlots[slotIdx + i];
        const slotKey = `${candidateDay}_${checkSlot}`;
        
        if (!this.usedRoomsPerSlot[slotKey]) {
          this.usedRoomsPerSlot[slotKey] = new Set();
        }
        
        const usedInSlot = this.usedRoomsPerSlot[slotKey].size;
        
        // ⚠️ Need at least 5 rooms free (buffer for grouped sections)
        if (usedInSlot >= roomsList.length - 5) {
          roomsAvailable = false;
          console.log(`⚠️ Slot ${candidateDay} ${checkSlot} nearly full: ${usedInSlot}/${roomsList.length} rooms used`);
          break;
        }
      }
      
      isSafe = roomsAvailable;
    }
    
    if (isSafe) {
      safeSlots.push(slot);
    }
  }
  
  if (safeSlots.length > 0) {
    bestDay = candidateDay;
    const chosenSlot = safeSlots[globalSlotIndex % safeSlots.length];
    const chosenIdx = this.timeSlots.indexOf(chosenSlot);
    
    bestSlots = [];
    for (let i = 0; i < slotsNeeded; i++) {
      bestSlots.push(this.timeSlots[chosenIdx + i]);
    }
    
    foundSafeSlot = true;
    console.log(`✅ Found safe non-consecutive slot for ${code}: ${bestDay} ${bestSlots.join(',')}`);
    break;
  }
}
        
        // Fallback: allow consecutive if needed
        if (!foundSafeSlot) {
          console.warn(`⚠️ Could not find non-consecutive slot for ${code}, trying fallback`);
          
          for (const candidateDay of sortedDays) {
            let availableSlots = [...this.timeSlots];
            
            if (isPartTime) {
              const partTimeStartIndex = this.timeSlots.findIndex(s => s.startsWith('1:30') || s.startsWith('1:00'));
              if (partTimeStartIndex !== -1) {
                availableSlots = this.timeSlots.slice(partTimeStartIndex);
              }
            }
            const sectionCount = subjectSectionCount[subjectTitleKey] || 1;
    const isAlliedCourse = sectionCount > 1;
    if (isAlliedCourse) {
      availableSlots = availableSlots.filter(t => !t.startsWith('7:30'));
    }

            if (candidateDay === lastDay) {
              availableSlots = this.getMorningSlots(availableSlots);
              if (availableSlots.length === 0) continue;
            }
            
            for (const slot of availableSlots) {
              const slotIdx = this.timeSlots.indexOf(slot);
              const checkSlots: string[] = [];
              
              let hasRooms = true;
              for (let i = 0; i < slotsNeeded; i++) {
                const checkSlot = this.timeSlots[slotIdx + i];
                if (!checkSlot) {
                  hasRooms = false;
                  break;
                }
                checkSlots.push(checkSlot);
                
                const slotKey = `${candidateDay}_${checkSlot}`;
                if (!this.usedRoomsPerSlot[slotKey]) {
                  this.usedRoomsPerSlot[slotKey] = new Set();
                }
                if (this.usedRoomsPerSlot[slotKey].size >= roomsList.length) {
                  hasRooms = false;
                  break;
                }
              }
              
              if (hasRooms) {
                bestDay = candidateDay;
                bestSlots = checkSlots;
                foundSafeSlot = true;
                console.warn(`⚠️ Using fallback slot for ${code}: ${bestDay} ${bestSlots.join(',')}`);
                break;
              }
            }
            
            if (foundSafeSlot) break;
          }
        }
        
        if (!foundSafeSlot) {
          console.error(`❌ CRITICAL: Cannot schedule ${code} - no valid slots on any day!`);
          continue;
        }
        
        day = bestDay;
        slots = bestSlots;
        
        examsPerDay[day]++;
        
        slots.forEach(slot => {
          courseSlotsByDay[course][day].add(slot);
        });
        
        globalSlotIndex = (globalSlotIndex + slotsNeeded) % this.timeSlots.length;
        
        console.log(`🆕 New group for ${code}: ${day} ${slots.join(',')} (${subjectSectionCount[subjectTitleKey]} sections)`);
      }

      subjectTitleCodeSlot[subjectTitleCodeKey] = true;

      // Assign rooms
      if (slotsNeeded > 1) {
        if (!assignedRoom) {
          // Collect used rooms for all slots
          const usedRoomsForSlots = new Set<string>();
          slots.forEach(slot => {
            const slotKey = `${day}_${slot}`;
            if (this.usedRoomsPerSlot[slotKey]) {
              this.usedRoomsPerSlot[slotKey].forEach(room => usedRoomsForSlots.add(room));
            }
          });
          
          console.log(`🔍 Multi-slot exam ${exam.code} (${exam.deptCode}): Total rooms: ${roomsList.length}, Used in slots: ${usedRoomsForSlots.size}`);
          console.log(`   Available rooms: ${roomsList.filter(r => !usedRoomsForSlots.has(r)).join(', ')}`);
          
          // Try department-based assignment
          assignedRoom = this.assignRoomByDepartment(exam, usedRoomsForSlots, roomsList);
          
          if (assignedRoom && assignedRoom !== 'TBD') {
            // Mark room as used for all slots
            slots.forEach(slot => {
              const slotKey = `${day}_${slot}`;
              if (!this.usedRoomsPerSlot[slotKey]) {
                this.usedRoomsPerSlot[slotKey] = new Set();
              }
              this.usedRoomsPerSlot[slotKey].add(assignedRoom);
            });
            console.log(`✅ Department-based room assigned: ${assignedRoom} for ${exam.code}`);
          } else {
            console.error(`❌ No department room available for multi-slot exam ${exam.code} on ${day} - will show as 'Please assign room'`);
            assignedRoom = 'TBD';
          }
        }
        if (assignedRoom === 'TBD') assignedRoom = 'Please assign room';

        slots.forEach((slot, index) => {
          schedule.push({
            CODE: exam.code,
            SUBJECT_ID: exam.subjectId,
            DESCRIPTIVE_TITLE: exam.title,
            COURSE: exam.course,
            YEAR_LEVEL: exam.yearLevel,
            INSTRUCTOR: exam.instructor,
            DEPT: exam.dept,
            DEPT_SUB: exam.deptCode,
            OE: exam.oe,
            DAY: day,
            SLOT: slot,
            ROOM: assignedRoom,
            PROCTOR: exam.instructor || 'TBD',
            HAS_CONFLICT: false,
            IS_MULTI_SLOT: true,
            SLOT_INDEX: index,
            TOTAL_SLOTS: slotsNeeded
          });
        });
      } else {
        if (!assignedRoom) {
          const slotKey = `${day}_${slots[0]}`;
          const usedRoomsForSlot = this.usedRoomsPerSlot[slotKey] || new Set<string>();
          
          console.log(`🔍 Single-slot exam ${exam.code} (${exam.deptCode}): Total rooms: ${roomsList.length}, Used in slot: ${usedRoomsForSlot.size}`);
          console.log(`   Available rooms: ${roomsList.filter(r => !usedRoomsForSlot.has(r)).join(', ')}`);
          
          // Try department-based assignment
          assignedRoom = this.assignRoomByDepartment(exam, usedRoomsForSlot, roomsList);
          
          if (assignedRoom && assignedRoom !== 'TBD') {
            // Mark room as used
            if (!this.usedRoomsPerSlot[slotKey]) {
              this.usedRoomsPerSlot[slotKey] = new Set();
            }
            this.usedRoomsPerSlot[slotKey].add(assignedRoom);
            console.log(`✅ Department-based room assigned: ${assignedRoom} for ${exam.code}`);
          } else {
            console.warn(`⚠️ No department room available for ${exam.code} - will show as 'Please assign room'`);
            assignedRoom = 'TBD';
          }
        }
        if (assignedRoom === 'TBD') assignedRoom = 'Please assign room';
        
        schedule.push({
          CODE: exam.code,
          SUBJECT_ID: exam.subjectId,
          DESCRIPTIVE_TITLE: exam.title,
          COURSE: exam.course,
          YEAR_LEVEL: exam.yearLevel,
          INSTRUCTOR: exam.instructor,
          DEPT: exam.dept,
          DEPT_SUB: exam.deptCode,
          OE: exam.oe,
          DAY: day,
          SLOT: slots[0],
          ROOM: assignedRoom,
          PROCTOR: exam.instructor || 'TBD',
          HAS_CONFLICT: false,
          IS_MULTI_SLOT: false,
          SLOT_INDEX: 0,
          TOTAL_SLOTS: 1
        });
      }
      
      if (!subjectTitleSlot[subjectTitleKey]) {
        subjectTitleSlot[subjectTitleKey] = { 
          day, 
          slots, 
          room: assignedRoom,
          codes: new Set([code]) 
        };
      }
    }
  }
  
  this.generatedSchedule = schedule;
  this.validateScheduleConstraints(schedule);
  

    this.detectScheduleConflicts();


  console.log('\n📊 FINAL DISTRIBUTION:');
  this.days.forEach(day => {
    const count = schedule.filter(s => s.DAY === day).length;
    const morningCount = schedule.filter(s => s.DAY === day && this.isMorningSlot(s.SLOT)).length;
    const afternoonCount = count - morningCount;
    console.log(`  ${day}: ${count} exams (${morningCount} morning, ${afternoonCount} afternoon)`);
  });
  
  this.detectUnscheduledExams();

  this.unscheduledExams = this.exams.filter(e => {
    return !this.generatedSchedule.some(s =>
      (s.CODE || '').toUpperCase() === (e.code || '').toUpperCase()
    );
  });

  console.log('\n📋 UNSCHEDULED EXAMS:', this.unscheduledExams.length);
  if (this.unscheduledExams.length > 0) {
    console.log(this.unscheduledExams.map(e => e.code).join(', '));
  }

  this.detectProctorConflicts();
  this.currentStep = 'generate';
  this.showToast('Schedule Generated', `${schedule.length} exams scheduled successfully and ${this.UnenrolledExam.length} removed Unenrolled Exams`);
  this.autoSaveToLocalStorage();
  this.diagnosticRoomAssignment();
}

getFirstAvailableRoom(day: string, slots: string[], roomsList: string[]): string | null {
  for (const room of roomsList) {
    let roomAvailable = true;
    for (const slot of slots) {
      const key = `${day}_${slot}`;
      if (!this.usedRoomsPerSlot[key]) this.usedRoomsPerSlot[key] = new Set();
      if (this.usedRoomsPerSlot[key].has(room)) {
        roomAvailable = false;
        break;
      }
    }
    if (roomAvailable) {
      // Mark room as used for all slots
      for (const slot of slots) {
        this.usedRoomsPerSlot[`${day}_${slot}`].add(room);
      }
      return room;
    }
  }
  return null;
}

computeCombinedTime(startSlot: string, totalSlots: number): string {
  const slotTimes: { [key: string]: { start: string; end: string } } = {
    "9:00 - 10:30": { start: "9:00", end: "10:30" },
    "10:30 - 12:00": { start: "10:30", end: "12:00" },
    "1:00 - 2:30": { start: "1:00", end: "2:30" },
    "2:30 - 4:00": { start: "2:30", end: "4:00" }
  };

  const slotIndex = this.timeSlots.indexOf(startSlot);
  if (slotIndex === -1) return startSlot;

  const start = slotTimes[startSlot].start;

  const endSlot = this.timeSlots[slotIndex + totalSlots - 1];
const endSlotTime = slotTimes[endSlot];
const end = (endSlotTime && endSlotTime.end) || slotTimes[startSlot].end;
  return `${start} - ${end}`;
}

getMergedSlot(exam: any): string {
  // If not multi-slot, return regular slot
  if (!exam.IS_MULTI_SLOT || exam.SLOT_INDEX !== 0) {
    return exam.SLOT;
  }
  
  // Find the starting slot index
  const slotIndex = this.timeSlots.indexOf(exam.SLOT);
  if (slotIndex === -1) return exam.SLOT;
  
  // Get all slots for this exam
  const slots: string[] = [];
  for (let i = 0; i < exam.TOTAL_SLOTS; i++) {
    const slot = this.timeSlots[slotIndex + i];
    if (slot) slots.push(slot);
  }
  
  // Merge the time range
  if (slots.length === 1) return slots[0];
  
  const firstSlot = slots[0];
  const lastSlot = slots[slots.length - 1];
  
  const startTime = firstSlot.split('-')[0].trim();
  const endTime = lastSlot.split('-')[1].trim();
  
  return `${startTime} - ${endTime}`;
}

get displayedSchedule() {
  // Filter to show only first slot of multi-slot exams
  return this.filteredSchedule.filter(exam => 
    !exam.IS_MULTI_SLOT || exam.SLOT_INDEX === 0
  );
}

// ⭐ NEW HELPER METHOD: Check if a slot is consecutive to any slot in a set
isSlotConsecutiveToAny(slot: string, usedSlots: Set<string>): boolean {
  const slotIndex = this.timeSlots.indexOf(slot);
  
  if (slotIndex === -1) return false; // Invalid slot
  
  for (const usedSlot of usedSlots) {
    const usedIndex = this.timeSlots.indexOf(usedSlot);
    
    if (usedIndex === -1) continue; // Invalid used slot
    
    // Check if adjacent (difference of 1)
    if (Math.abs(slotIndex - usedIndex) === 1) {
      console.log(`   ⚠️ Slot ${slot} is consecutive to used slot ${usedSlot}`);
      return true;
    }
  }
  
  return false;
}

// ⭐ NEW HELPER METHOD: Check if a range of slots would create consecutive conflicts
wouldCreateConsecutive(startSlot: string, slotsNeeded: number, usedSlots: Set<string>): boolean {
  const startIdx = this.timeSlots.indexOf(startSlot);
  if (startIdx === -1) return true; // Invalid slot
  
  // Check if any slot in the range or adjacent to it is used
  for (let i = -1; i <= slotsNeeded; i++) {
    const checkIdx = startIdx + i;
    if (checkIdx < 0 || checkIdx >= this.timeSlots.length) continue;
    
    const checkSlot = this.timeSlots[checkIdx];
    
    // If this is a slot in the range (not the boundaries), it must not be used
    if (i >= 0 && i < slotsNeeded) {
      if (usedSlots.has(checkSlot)) {
        return true; // Slot already used
      }
    }
    // If this is the slot before or after the range, it must not be used
    else if (i === -1 || i === slotsNeeded) {
      if (usedSlots.has(checkSlot)) {
        console.log(`   ⚠️ Would create consecutive: ${checkSlot} is adjacent to range`);
        return true; // Would be consecutive
      }
    }
  }
  
  return false;
}

// ⭐ NEW VALIDATION METHOD: Check for constraint violations
validateScheduleConstraints(schedule: ScheduledExam[]) {
  console.log('\n🔍 VALIDATING SCHEDULE CONSTRAINTS...');
  
  const lastDay = this.days[this.days.length - 1];
  let violations = {
    consecutive: [] as string[],
    lastDayAfternoon: [] as string[]
  };
  
  // Check 1: No afternoon exams on last day
  const lastDayAfternoonExams = schedule.filter(s => 
    s.DAY === lastDay && !this.isMorningSlot(s.SLOT)
  );
  
  if (lastDayAfternoonExams.length > 0) {
    console.warn(`\n⚠️ VIOLATION: ${lastDayAfternoonExams.length} exams scheduled after 12pm on last day:`);
    lastDayAfternoonExams.forEach(e => {
      console.warn(`   - ${e.CODE} at ${e.SLOT}`);
      violations.lastDayAfternoon.push(`${e.CODE} at ${e.SLOT}`);
    });
  } else {
    console.log(`✅ PASS: All ${lastDay} exams are before 12pm`);
  }
  
  // Check 2: No consecutive exams per course
  const courseSchedules: { [course: string]: ScheduledExam[] } = {};
  schedule.forEach(exam => {
    if (!courseSchedules[exam.COURSE]) {
      courseSchedules[exam.COURSE] = [];
    }
    courseSchedules[exam.COURSE].push(exam);
  });
  
  Object.entries(courseSchedules).forEach(([course, exams]) => {
    const examsByDay: { [day: string]: ScheduledExam[] } = {};
    
    exams.forEach(exam => {
      if (!examsByDay[exam.DAY]) {
        examsByDay[exam.DAY] = [];
      }
      examsByDay[exam.DAY].push(exam);
    });
    
    Object.entries(examsByDay).forEach(([day, dayExams]) => {
      // Sort by slot
      const sorted = dayExams.sort((a, b) => {
        const aIdx = this.timeSlots.indexOf(a.SLOT);
        const bIdx = this.timeSlots.indexOf(b.SLOT);
        return aIdx - bIdx;
      });
      
      // Check for consecutive
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];
        
        if (this.areSlotConsecutive(current.SLOT, next.SLOT)) {
          const violation = `${course} on ${day}: ${current.CODE} (${current.SLOT}) → ${next.CODE} (${next.SLOT})`;
          console.warn(`⚠️ CONSECUTIVE: ${violation}`);
          violations.consecutive.push(violation);
        }
      }
    });
  });
  
  if (violations.consecutive.length === 0) {
    console.log('✅ PASS: No consecutive exams detected');
  } else {
    console.warn(`\n⚠️ VIOLATION: ${violations.consecutive.length} consecutive exam pairs found`);
  }
  
  // Show summary
  const totalViolations = violations.consecutive.length + violations.lastDayAfternoon.length;
  if (totalViolations > 0) {
    this.showToast(
      'Schedule Constraints',
      `${totalViolations} constraint violation(s) detected. Check console for details.`,
      'warning'
    );
  } else {
    console.log('\n✅✅✅ ALL CONSTRAINTS SATISFIED! ✅✅✅');
  }
}


// ⭐ NEW HELPER METHOD: Check if a slot is consecutive to any slot in a set
// Helper method to check if time slot is in the morning (before 12pm)
private isMorningSlot(slot: string): boolean {
  const startTime = slot.split('-')[0].trim();
  
  // Remove any whitespace and convert to uppercase
  const timeStr = startTime.toUpperCase().replace(/\s+/g, '');
  
  // Check for explicit PM marker (definitely afternoon)
  if (timeStr.includes('PM')) {
    // Exception: 12:00 PM to 12:59 PM is technically afternoon but we'll exclude it
const match = timeStr.match(/(\d+):/);
const hour = parseInt(match ? match[1] : '0');
    return false; // All PM times are afternoon
  }
  
  // Check for explicit AM marker
  if (timeStr.includes('AM')) {
const match = timeStr.match(/(\d+):/);
const hour = parseInt(match ? match[1] : '0');
    // 12:00 AM is midnight, but 1-11 AM is morning
    return hour !== 12; // Exclude 12:00 AM (midnight)
  }
  
  // No AM/PM marker - parse as 24-hour or assume format
  const hourMatch = timeStr.match(/^(\d+):/);
  if (hourMatch) {
    const hour = parseInt(hourMatch[1]);
    
    // 24-hour format: 0-11 is morning, 12+ is afternoon/evening
    if (hour >= 0 && hour < 12) {
      return true;
    }
    
    // 12-hour format without AM/PM: assume based on typical class hours
    // 7, 8, 9, 10, 11 are morning
    // 1, 2, 3, 4, 5, 6 without PM could be afternoon (13-18 in 24h)
    if (hour >= 7 && hour < 12) {
      return true;
    }
  }
  
  return false; // Default to afternoon if can't determine
}

// Enhanced method to get morning slots only (before 12:00 PM)
private getMorningSlots(allSlots: string[]): string[] {
  const morning = allSlots.filter(slot => this.isMorningSlot(slot));
  console.log(`🌅 Morning slots available: ${morning.length}/${allSlots.length}`);
  console.log(`   Slots: ${morning.join(', ')}`);
  return morning;
}


detectUnscheduledExams() {
  const scheduledCodes = new Set(this.generatedSchedule.map(e => e.CODE));
  this.unscheduledExams = this.exams.filter(e => !scheduledCodes.has(e.code));

  if (this.unscheduledExams.length > 0) {
    console.warn('⚠️ Unscheduled exams:', this.unscheduledExams);
    this.showToast(
      'Warning',
      `${this.unscheduledExams.length} exam(s) could not be scheduled.`,
      'warning'
    );
  } else {
    console.log('✅ All exams scheduled');
  }
}


// NEW: Get room that's free in ALL slots AND use same room (for 6+ unit exams)
getFreeRoomForMultiSlotSameRoom(exam: Exam, day: string, slots: string[], roomsList: string[]): string {
  const usedRoomsAcrossAllSlots = new Set<string>();
  
  // Check which rooms are used in ANY of the target slots
  for (const slot of slots) {
    const key = `${day}_${slot}`;
    if (!this.usedRoomsPerSlot[key]) {
      this.usedRoomsPerSlot[key] = new Set();
    }
    this.usedRoomsPerSlot[key].forEach(room => usedRoomsAcrossAllSlots.add(room));
  }

  // Find ONE room that's free in ALL slots
  const room = this.assignRoomByDepartment(exam, usedRoomsAcrossAllSlots, roomsList);
  
  if (!room) {
    console.warn(`⚠️ No available room for ${exam.code} at ${day} ${slots.join(',')} (${slots.length} slots needed)`);
    return '';
  }

  // Mark this SAME room as used for ALL slots
  for (const slot of slots) {
    const key = `${day}_${slot}`;
    if (!this.usedRoomsPerSlot[key]) {
      this.usedRoomsPerSlot[key] = new Set();
    }
    this.usedRoomsPerSlot[key].add(room);
  }
  
  console.log(`✓ Assigned ${room} to ${exam.code} for ALL ${slots.length} slots: ${day} ${slots.join(',')}`);
  return room;
}

// 2. STRICT room assignment for single slot (prevents overlaps)
getFreeRoomForSlotStrict(exam: Exam, day: string, slot: string, roomsList: string[]): string {
  const slotKey = `${day}_${slot}`;

  if (!this.usedRoomsPerSlot[slotKey]) {
    this.usedRoomsPerSlot[slotKey] = new Set<string>();
  }

  const roomsAlreadyUsed = this.usedRoomsPerSlot[slotKey];
  
  // Get room based on department preference
  const room = this.assignRoomByDepartment(exam, roomsAlreadyUsed, roomsList);
  
  if (!room) {
    console.warn(`⚠️ No available room for ${exam.code} at ${day} ${slot}`);
    return '';
  }

  // Mark room as used for this slot
  roomsAlreadyUsed.add(room);
  
  console.log(`✓ Assigned ${room} to ${exam.code} at ${day} ${slot}`);
  return room;
}

// 3. STRICT multi-slot room assignment (prevents overlaps across all slots)
getFreeRoomForMultiSlotStrict(exam: Exam, day: string, slots: string[], roomsList: string[]): string {
  const usedRoomsAcrossAllSlots = new Set<string>();
  
  // Check which rooms are used in ANY of the target slots
  for (const slot of slots) {
    const key = `${day}_${slot}`;
    if (!this.usedRoomsPerSlot[key]) {
      this.usedRoomsPerSlot[key] = new Set();
    }
    this.usedRoomsPerSlot[key].forEach(room => usedRoomsAcrossAllSlots.add(room));
  }

  // Find a room that's free in ALL slots
  const room = this.assignRoomByDepartment(exam, usedRoomsAcrossAllSlots, roomsList);
  
  if (!room) {
    console.warn(`⚠️ No available room for ${exam.code} at ${day} ${slots.join(',')}`);
    return '';
  }

  // Mark this room as used for ALL slots
  for (const slot of slots) {
    const key = `${day}_${slot}`;
    if (!this.usedRoomsPerSlot[key]) {
      this.usedRoomsPerSlot[key] = new Set();
    }
    this.usedRoomsPerSlot[key].add(room);
  }
  
  console.log(`✓ Assigned ${room} to ${exam.code} (multi-slot) at ${day} ${slots.join(',')}`);
  return room;
}

// 4. Helper to properly split merged slots
getSlotsArray(slot: string): string[] {
  if (!slot.includes('-') || this.timeSlots.includes(slot)) {
    return [slot];
  }

  const parts = slot.split('-');
  if (parts.length !== 2) return [slot];

  const [startTime, endTime] = parts.map(s => s.trim());
  const allSlots: string[] = [];
  let adding = false;

  for (const ts of this.timeSlots) {
    const tsParts = ts.split('-');
    const tsStart = tsParts[0] ? tsParts[0].trim() : '';
    const tsEnd = tsParts[1] ? tsParts[1].trim() : '';

    if (tsStart === startTime) adding = true;
    if (adding) allSlots.push(ts);
    if (tsEnd === endTime) break;
  }

  return allSlots.length > 0 ? allSlots : [slot];
}



// 6. Show move options (called from grid)
showMoveOptions(exam: ScheduledExam, currentDay: string, currentSlot: string) {
  console.log('=== showMoveOptions called ===');
  console.log('Exam:', exam);
  console.log('Current Day:', currentDay, 'Current Slot:', currentSlot);

  if (!exam || !exam.CODE || !exam.SUBJECT_ID) {
    console.error('❌ Invalid exam data');
    this.showToast('Error', 'Invalid exam data', 'destructive');
    return;
  }

  // Ensure the exam has the current day and slot
  if (!exam.DAY) exam.DAY = currentDay;
  if (!exam.SLOT) exam.SLOT = currentSlot;

  // Find all exams with SAME TITLE + SUBJECT_ID (regardless of CODE)
  // This will move all sections together
  const groupExams = this.generatedSchedule.filter(e => 
    e.SUBJECT_ID === exam.SUBJECT_ID &&
    e.DESCRIPTIVE_TITLE === exam.DESCRIPTIVE_TITLE &&
    e.DAY === exam.DAY &&
    e.SLOT === exam.SLOT
  );

  console.log(`Found ${groupExams.length} exam(s) with same title/subjectID to move together:`, groupExams.map(e => e.CODE));

  if (groupExams.length === 0) {
    console.error('❌ Exam not found in schedule');
    console.log('Searching for:', { CODE: exam.CODE, SUBJECT_ID: exam.SUBJECT_ID, DAY: exam.DAY, SLOT: exam.SLOT });
    console.log('Available in schedule:', this.generatedSchedule.map(e => ({ 
      CODE: e.CODE, 
      SUBJECT_ID: e.SUBJECT_ID, 
      DAY: e.DAY, 
      SLOT: e.SLOT 
    })));
    this.showToast('Error', 'Exam not found in schedule', 'destructive');
    return;
  }

  // Set moveExamData with proper structure
  this.moveExamData = {
    exam: groupExams[0], // Use the first exam from the actual schedule
    groupExams: groupExams,
    // Include these for backward compatibility with your popup
    CODE: groupExams[0].CODE,
    SUBJECT_ID: groupExams[0].SUBJECT_ID,
    DESCRIPTIVE_TITLE: groupExams[0].DESCRIPTIVE_TITLE,
    COURSE: groupExams[0].COURSE,
    YEAR_LEVEL: groupExams[0].YEAR_LEVEL,
    INSTRUCTOR: groupExams[0].INSTRUCTOR,
    DEPT: groupExams[0].DEPT,
    OE: groupExams[0].OE,
    DAY: groupExams[0].DAY,
    SLOT: groupExams[0].SLOT,
    ROOM: groupExams[0].ROOM,
    PROCTOR: groupExams[0].PROCTOR,
    HAS_CONFLICT: groupExams[0].HAS_CONFLICT
  };

  console.log('✓ moveExamData initialized:', this.moveExamData);

  // Calculate safe slots
  this.calculateSafeSlots(exam.COURSE);
  
  // Show move popup
  this.movePopupVisible = true;

  this.showToast('Move Mode', `Moving ${groupExams.length} exam(s). Select a new slot.`);
}

// 7. Calculate safe slots for moving
calculateSafeSlots(course: string) {
  this.safeSlots = [];
  
  if (!course) {
    console.warn('⚠️ No course provided for safe slot calculation');
    return;
  }
  
  this.days.forEach(day => {
    this.timeSlots.forEach(slot => {
      // Check if this slot is free for the course
      const hasConflict = this.generatedSchedule.some(e => 
        e.COURSE === course && 
        e.DAY === day && 
        e.SLOT === slot
      );
      
      if (!hasConflict) {
        this.safeSlots.push({ day, slot });
      }
    });
  });
  
  console.log(`✓ Found ${this.safeSlots.length} safe slots for ${course}`);
}

// 8. Apply move with COMPREHENSIVE safety checks
applyMove(newDay: string, newSlot: string) {
  console.log('=== applyMove called ===');
  console.log('moveExamData:', this.moveExamData);
  
  // Safety check 1: moveExamData exists
  if (!this.moveExamData) {
    console.error('❌ moveExamData is null or undefined');
    this.showToast('Error', 'No exam data found', 'destructive');
    this.movePopupVisible = false;
    return;
  }

  console.log('moveExamData keys:', Object.keys(this.moveExamData));
  console.log('groupExams:', this.moveExamData.groupExams);

  // Safety check 2: Extract groupExams safely
  let groupExams = this.moveExamData.groupExams;
  
  // If groupExams doesn't exist, try to find the exam manually
  if (!groupExams || !Array.isArray(groupExams) || groupExams.length === 0) {
    console.warn('⚠️ groupExams invalid, attempting to recover...');
    
    // Try to get the single exam
    const singleExam = this.moveExamData.exam || this.moveExamData;
    
    if (!singleExam || !singleExam.CODE) {
      console.error('❌ Cannot recover exam data');
      this.showToast('Error', 'Invalid exam data for move operation', 'destructive');
      this.movePopupVisible = false;
      this.moveExamData = null;
      return;
    }
    
    // Find all matching exams in the schedule
    groupExams = this.generatedSchedule.filter(e => 
      e.CODE === singleExam.CODE &&
      e.SUBJECT_ID === singleExam.SUBJECT_ID &&
      e.DAY === singleExam.DAY &&
      e.SLOT === singleExam.SLOT
    );
    
    console.log(`✓ Recovered ${groupExams.length} exam(s) to move`);
  }

  if (groupExams.length === 0) {
    console.error('❌ No exams found to move');
    this.showToast('Error', 'No exams found to move', 'destructive');
    this.movePopupVisible = false;
    this.moveExamData = null;
    return;
  }

  console.log(`📦 Moving ${groupExams.length} exam(s)`, groupExams);

  const allRooms = this.rooms.length > 0 ? this.rooms : ['A', 'C', 'K', 'L', 'M', 'N'];
  const roomsList = this.getAvailableRooms(allRooms); // Filter out restricted rooms

  // Clear old room usage for all exams in group
  groupExams.forEach((exam: ScheduledExam) => {
    const oldSlots = this.getSlotsArray(exam.SLOT);
    oldSlots.forEach(s => {
      const key = `${exam.DAY}_${s}`;
      if (this.usedRoomsPerSlot[key]) {
        this.usedRoomsPerSlot[key].delete(exam.ROOM);
      }
    });
  });

  // Get slot key for new location
  const slotKey = `${newDay}_${newSlot}`;
  if (!this.usedRoomsPerSlot[slotKey]) {
    this.usedRoomsPerSlot[slotKey] = new Set();
  }
  const usedRooms = this.usedRoomsPerSlot[slotKey];

  // Track rooms assigned in this batch
  const assignedRoomsInBatch = new Set<string>();
  let assignmentSuccess = true;

  groupExams.forEach((exam: ScheduledExam) => {
    const index = this.generatedSchedule.findIndex(e =>
      e.CODE === exam.CODE &&
      e.SUBJECT_ID === exam.SUBJECT_ID &&
      e.DAY === exam.DAY &&
      e.SLOT === exam.SLOT
    );

    if (index !== -1) {
      // Map to Exam
     const originalExam = this.exams.find(e => e.code === exam.CODE);
      const examForRoom: Exam = {
        code: exam.CODE,
        subjectId: exam.SUBJECT_ID,
        title: exam.DESCRIPTIVE_TITLE,
        course: exam.COURSE,
        deptCode: exam.DEPT_SUB,
        yearLevel: exam.YEAR_LEVEL,
        instructor: exam.INSTRUCTOR,
        dept: exam.DEPT,
        lec: 0,
        lab: 0,
        oe: exam.OE || 0,
        version: '',
        room: (originalExam && originalExam.room) || ''
      };

      // CRITICAL: Combine used rooms with batch rooms to prevent duplicates
      const combinedUsed = new Set([...usedRooms, ...assignedRoomsInBatch]);
      const newRoom = this.assignRoomByDepartment(examForRoom, combinedUsed, roomsList);

      if (!newRoom) {
        console.error(`❌ No room available for ${exam.CODE}`);
        assignmentSuccess = false;
        this.showToast('Error', `No available room for ${exam.CODE}`, 'destructive');
        return;
      }

      // Update exam
      this.generatedSchedule[index].DAY = newDay;
      this.generatedSchedule[index].SLOT = newSlot;
      this.generatedSchedule[index].ROOM = newRoom;

      // Mark room as used
      usedRooms.add(newRoom);
      assignedRoomsInBatch.add(newRoom);
      
      console.log(`✓ Moved ${exam.CODE} to ${newDay} ${newSlot} → Room ${newRoom}`);
    }
  });

  if (!assignmentSuccess) {
    this.showToast('Warning', 'Some exams could not be assigned rooms', 'warning');
  }

  // Rebuild grid
  this.generateCourseGridData();
  this.detectProctorConflicts();
  this.autoSaveToLocalStorage();

  this.movePopupVisible = false;
  this.moveExamData = null;
  this.safeSlots = [];

  this.showToast('Success', `${groupExams.length} exam(s) moved to ${newDay} ${newSlot}`);
  this.cd.detectChanges();
}

// 9. Close move popup safely
closeMovePopup() {
  this.movePopupVisible = false;
  this.moveExamData = null;
  this.safeSlots = [];
  console.log('✓ Move popup closed');
}

// 10. Remove exam by title (from grid button)
// removeExamByTitle(title: string) {
//   if (!title) {
//     this.showToast('Error', 'No title provided', 'destructive');
//     return;
//   }

//   const confirmed = confirm(`Are you sure you want to remove all exams with title "${title}"?`);
//   if (!confirmed) return;

//   // Find all exams with this title
//   const examsToRemove = this.generatedSchedule.filter(e => 
//     (e.DESCRIPTIVE_TITLE || '').toUpperCase().trim() === title.toUpperCase().trim()
//   );

//   if (examsToRemove.length === 0) {
//     this.showToast('Error', 'No exams found with this title', 'destructive');
//     return;
//   }

//   console.log(`Removing ${examsToRemove.length} exam(s) with title "${title}"`);

//   // Clear room usage for these exams
//   examsToRemove.forEach(exam => {
//     const slots = this.getSlotsArray(exam.SLOT);
//     slots.forEach(slot => {
//       const key = `${exam.DAY}_${slot}`;
//       if (this.usedRoomsPerSlot[key]) {
//         this.usedRoomsPerSlot[key].delete(exam.ROOM);
//       }
//     });
//   });

//   // Remove from schedule
//   this.generatedSchedule = this.generatedSchedule.filter(e => 
//     (e.DESCRIPTIVE_TITLE || '').toUpperCase().trim() !== title.toUpperCase().trim()
//   );

//   // Rebuild grid
//   this.generateCourseGridData();
//   this.detectProctorConflicts();
//   this.autoSaveToLocalStorage();

//   this.showToast('Removed', `${examsToRemove.length} exam(s) removed`);
// }

removeExamByTitle(title: string) {
  if (!title) {
    this.showToast('Error', 'No title provided', 'destructive');
    return;
  }

  const confirmed = confirm(`Are you sure you want to remove all exams with title "${title}"?`);
  if (!confirmed) return;

  // Find all exams with this title (including all slots of multi-slot exams)
  const examsToRemove = this.generatedSchedule.filter(e => 
    (e.DESCRIPTIVE_TITLE || '').toUpperCase().trim() === title.toUpperCase().trim()
  );

  if (examsToRemove.length === 0) {
    this.showToast('Error', 'No exams found with this title', 'destructive');
    return;
  }

  console.log(`Removing ${examsToRemove.length} exam slot(s) with title "${title}"`);

  // Clear room usage for all slots
  examsToRemove.forEach(exam => {
    const key = `${exam.DAY}_${exam.SLOT}`;
    if (this.usedRoomsPerSlot[key]) {
      this.usedRoomsPerSlot[key].delete(exam.ROOM);
    }
  });

  // Remove all slots from schedule
  this.generatedSchedule = this.generatedSchedule.filter(e => 
    (e.DESCRIPTIVE_TITLE || '').toUpperCase().trim() !== title.toUpperCase().trim()
  );

  // Rebuild grid
  this.generateCourseGridData();
  this.detectProctorConflicts();
  this.autoSaveToLocalStorage();

  // Count unique exams removed
  const uniqueCodes = new Set(examsToRemove.map(e => e.CODE));
  this.showToast('Removed', `${uniqueCodes.size} exam(s) removed (${examsToRemove.length} slot entries)`);
}


removeExamByCode(code: string) {
  if (!code) {
    this.showToast('Error', 'No code provided', 'destructive');
    return;
  }

  Swal.fire({
    title: 'Remove Exam?',
    text: `Remove all slots for exam ${code}?`,
    type: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    confirmButtonText: 'Yes, remove it!'
  }).then((result) => {
    if (result.value) {
      // Find all slots for this exam (including multi-slot)
      const examsToRemove = this.generatedSchedule.filter(e => 
        e.CODE.toUpperCase().trim() === code.toUpperCase().trim()
      );

      // Clear room usage
      examsToRemove.forEach(exam => {
        const key = `${exam.DAY}_${exam.SLOT}`;
        if (this.usedRoomsPerSlot[key]) {
          this.usedRoomsPerSlot[key].delete(exam.ROOM);
        }
      });

      // Remove all entries
      this.generatedSchedule = this.generatedSchedule.filter(e => 
        e.CODE.toUpperCase().trim() !== code.toUpperCase().trim()
      );

      this.generateCourseGridData();
      this.detectProctorConflicts();
      this.autoSaveToLocalStorage();

      this.showToast('Removed', `Exam ${code} removed (${examsToRemove.length} slot entries)`);
      this.cd.detectChanges();
    }
  });
}

isFirstSlotOfMultiSlot(exam: any): boolean {
  return exam.IS_MULTI_SLOT && exam.SLOT_INDEX === 0;
}

isLastSlotOfMultiSlot(exam: any): boolean {
  return exam.IS_MULTI_SLOT && exam.SLOT_INDEX === (exam.TOTAL_SLOTS || 1) - 1;
}

// NEW: Toggle unscheduled exams panel
toggleUnscheduledPanel() {
  this.showUnscheduledPanel = !this.showUnscheduledPanel;
}


openUnscheduledPanel() {
  console.log('🔓 openUnscheduledPanel called');

  const count = this.unscheduledExams ? this.unscheduledExams.length : 0;
  console.log('Unscheduled exams count:', count);

   if (!this.unscheduledExams || this.unscheduledExams.length === 0) {
    alert('✅ No unscheduled exams'); // popup
    return;
  }

  this.showUnscheduledPanel = true;
    this.cdr.detectChanges(); // <- force Angular to refresh the template

  console.log('✅ Panel opened, showUnscheduledPanel =', this.showUnscheduledPanel);
}




// 3. Edit unscheduled exam
editUnscheduledExam(exam: Exam) {
  console.log('✏️ Editing exam:', exam);
  this.editingUnscheduledExam = exam;
  this.editFormData = {
    code: exam.code,
    subjectId: exam.subjectId,
    title: exam.title,
    course: exam.course,
    yearLevel: exam.yearLevel,
    instructor: exam.instructor,
    dept: exam.dept,
    lec: exam.lec || 0,
    lab: exam.lab || 0,
    oe: exam.oe || 0,
    version: exam.version || ''
  };
}

// 4. Cancel edit
cancelEditUnscheduledExam() {
  this.editingUnscheduledExam = null;
  this.editFormData = null;
}

// 5. Save edited exam and reschedule it
saveAndRescheduleExam() {
  if (!this.editingUnscheduledExam || !this.editFormData) {
    this.showToast('Error', 'No exam selected', 'destructive');
    return;
  }

  const updatedExam: Exam = {
    code: this.editFormData.code,
    subjectId: this.editFormData.subjectId,
    title: this.editFormData.title,
    course: this.editFormData.course,
        deptCode: this.editFormData.deptCode,

    yearLevel: this.editFormData.yearLevel,
    instructor: this.editFormData.instructor,
    dept: this.editFormData.dept,
    lec: this.editFormData.lec || 0,
   lab: this.editFormData.lec || 0,

    oe: this.editFormData.oe || 0,
    version: this.editFormData.version || ''
  };

  const index = this.exams.findIndex(e => e.code === this.editingUnscheduledExam.code);
  if (index !== -1) {
    this.exams[index] = updatedExam;
  }

  this.unscheduledExams = this.unscheduledExams.filter(e => e.code !== updatedExam.code);
  this.scheduleUnscheduledExam(updatedExam);

  this.editingUnscheduledExam = null;
  this.editFormData = null;

  this.showToast('Success', `Exam ${updatedExam.code} saved and scheduled`);
  this.autoSaveToLocalStorage();
}

// 6. Schedule a single unscheduled exam
scheduleUnscheduledExam(exam: Exam) {
  const allRooms = this.rooms.length > 0 ? this.rooms.sort() : ['A', 'C', 'K', 'L', 'M', 'N'];
  const roomsList = this.getAvailableRooms(allRooms);

  const subjectId = exam.subjectId ? exam.subjectId.toUpperCase().trim() : '';
  const title = exam.title ? exam.title.toUpperCase().trim() : '';
  const code = exam.code ? exam.code.toUpperCase().trim() : '';

  const alreadyScheduled = this.generatedSchedule.some(
    e => e.CODE === code && e.SUBJECT_ID === subjectId
  );
  if (alreadyScheduled) {
    this.showToast('Warning', `Exam ${code} is already scheduled`, 'warning');
    return;
  }

  let day = '';
  let slots: string[] = [];
  const totalUnits = (exam.lec || 0) + (exam.lab || 0);
  const slotsNeeded = totalUnits >= 6 ? 2 : 1;

  for (const dayOption of this.days) {
    let slotsFound = 0;
    const availableSlots: string[] = [];

    for (const slot of this.timeSlots) {
      const slotKey = `${dayOption}_${slot}`;
      if (!this.usedRoomsPerSlot[slotKey] || this.usedRoomsPerSlot[slotKey].size === 0) {
        availableSlots.push(slot);
        slotsFound++;
        if (slotsFound >= slotsNeeded) break;
      }
    }

    if (availableSlots.length >= slotsNeeded) {
      day = dayOption;
      slots = availableSlots.slice(0, slotsNeeded);
      break;
    }
  }

  if (!day || slots.length === 0) {
    console.warn(`⚠️ No available slots for ${code}`);
    this.showToast('Error', `No available slots for ${code}`, 'destructive');
    return;
  }

  let assignedRoom = '';
  if (slotsNeeded > 1) {
    assignedRoom = this.getFreeRoomForMultiSlotSameRoom(exam, day, slots, roomsList);
  } else {
    assignedRoom = this.getFreeRoomForSlotStrict(exam, day, slots[0], roomsList);
  }

  if (!assignedRoom) {
    this.showToast('Error', `No available room for ${code}`, 'destructive');
    return;
  }

  let mergedSlot = '';
  if (slots.length === 1) {
    mergedSlot = slots[0];
  } else {
    const firstSlot = slots[0];
    const lastSlot = slots[slots.length - 1];
    if (firstSlot.includes('-') && lastSlot.includes('-')) {
      const startTime = firstSlot.split('-')[0].trim();
      const endTime = lastSlot.split('-')[1].trim();
      mergedSlot = `${startTime}-${endTime}`;
    } else {
      mergedSlot = slots.join('-');
    }
  }

  this.generatedSchedule.push({
    CODE: exam.code,
    SUBJECT_ID: exam.subjectId,
    DESCRIPTIVE_TITLE: exam.title,
    COURSE: exam.course,
    YEAR_LEVEL: exam.yearLevel,
    INSTRUCTOR: exam.instructor,
    DEPT: exam.dept,
    DEPT_SUB: exam.deptCode,
    OE: exam.oe,
    DAY: day,
    SLOT: mergedSlot,
    ROOM: assignedRoom,
    PROCTOR: exam.instructor || 'TBD',
    HAS_CONFLICT: false
  });

  console.log(`✅ Scheduled ${code} at ${day} ${mergedSlot} in ${assignedRoom}`);
  this.generateCourseGridData();
  this.detectProctorConflicts();
}

deleteUnscheduledExam(exam: Exam) {
  const confirmed = confirm(`Delete exam ${exam.code} - ${exam.title}?`);
  if (!confirmed) return;

  this.exams = this.exams.filter(e => e.code !== exam.code);
  this.unscheduledExams = this.unscheduledExams.filter(e => e.code !== exam.code);

  this.showToast('Deleted', `Exam ${exam.code} deleted`);
  this.autoSaveToLocalStorage();
}

getUnscheduledCount(): number {
  return this.unscheduledExams ? this.unscheduledExams.length : 0;
}


testUnscheduledPanel() {
  console.log('🧪 TEST: Unscheduled Exams Panel');
  console.log('showUnscheduledPanel property exists:', this.hasOwnProperty('showUnscheduledPanel'));
  console.log('Current value:', this.showUnscheduledPanel);
console.log(
  'Unscheduled exams count:',
  this.unscheduledExams ? this.unscheduledExams.length : 0
);
  console.log('Unscheduled exams:', this.unscheduledExams);
  
  // Force toggle
  this.showUnscheduledPanel = !this.showUnscheduledPanel;
  console.log('✅ Toggled to:', this.showUnscheduledPanel);
}





// 2. OPTIMIZED: Get smart proctor suggestions with caching
getSmartProctorSuggestionsOptimized(exam: ScheduledExam): {
  sameSubject: string[];
  sameDept: string[];
  available: string[];
} {
  const cacheKey = `${exam.CODE}_${exam.DAY}_${exam.SLOT}_${exam.PROCTOR || ''}`;
  
  // Return cached result if available
  if (this.proctorSuggestionsCache.has(cacheKey)) {
    return this.proctorSuggestionsCache.get(cacheKey);
  }
  
  const examSubject = exam.SUBJECT_ID ? exam.SUBJECT_ID.toUpperCase().trim() : "";
  const examDept = exam.DEPT ? exam.DEPT.toUpperCase().trim() : "";
  
  const sameSubject: string[] = [];
  const sameDept: string[] = [];
  const available: string[] = [];
  
  const currentProctor = exam.PROCTOR ? exam.PROCTOR.toUpperCase().trim() : "";
  
  // Get all unique instructors
  const allInstructors = Array.from(new Set(
    this.generatedSchedule.map(e => e.INSTRUCTOR ? e.INSTRUCTOR.toUpperCase().trim() : "")
  )).filter(i => i);
  
  allInstructors.forEach(instructor => {
    const isCurrentlyAssigned = instructor === currentProctor;
    
    // Check if busy
    const isBusy = this.generatedSchedule.some(e =>
      e !== exam &&
      e.DAY === exam.DAY &&
      e.SLOT === exam.SLOT &&
      e.PROCTOR && 
      e.PROCTOR.toUpperCase().trim() === instructor &&
      instructor !== currentProctor
    );
    
    if (isBusy && !isCurrentlyAssigned) {
      return;
    }
    
    const instructorDept = this.instructorDepartments.get(instructor) || '';
    const instructorSubjects = this.instructorSubjects.get(instructor) || new Set();
    
    // Categorize
    if (examSubject && instructorSubjects.has(examSubject)) {
      sameSubject.push(instructor);
    } else if (examDept && instructorDept === examDept) {
      sameDept.push(instructor);
    } else {
      available.push(instructor);
    }
  });
  
  const result = {
    sameSubject: sameSubject.sort(),
    sameDept: sameDept.sort(),
    available: available.sort()
  };
  
  // Cache the result
  this.proctorSuggestionsCache.set(cacheKey, result);
  
  return result;
}



// 7. Clear cache when needed
clearProctorCache() {
  this.proctorSuggestionsCache.clear();
  this.filteredListCache = [];
  console.log('Proctor cache cleared');
}






// ============================================
// FINAL OPTIMIZED PROCTOR ASSIGNMENT CODE
// Pre-computes everything to avoid runtime calculations
// ============================================





// ============================================
// HIGHLY OPTIMIZED PROCTOR ASSIGNMENT
// Prevents UI freezing with chunked processing
// ============================================

// Add these properties to your component class


// 1. Initialize instructor data (fast - synchronous)
initializeInstructorData() {
  console.log('Initializing instructor data...');
  
  this.instructorSubjects.clear();
  this.instructorDepartments.clear();
  
  this.exams.forEach(exam => {
    const instructor = exam.instructor ? exam.instructor.toUpperCase().trim() : "";
    const subject = exam.subjectId ? exam.subjectId.toUpperCase().trim() : "";
    const dept = exam.dept ? exam.dept.toUpperCase().trim() : "";
    
    if (instructor) {
      if (!this.instructorSubjects.has(instructor)) {
        this.instructorSubjects.set(instructor, new Set());
      }
      if (subject) {
        this.instructorSubjects.get(instructor)!.add(subject);
      }
      
      if (dept && !this.instructorDepartments.has(instructor)) {
        this.instructorDepartments.set(instructor, dept);
      }
    }
  });
  
  console.log(`✓ Loaded ${this.instructorSubjects.size} instructors`);
}


// 2. OPTIMIZED: Pre-compute with real chunking and progress feedback
async precomputeAllProctorSuggestions() {
  console.log('Pre-computing proctor suggestions...');
  console.time('precompute-suggestions');
  
  this.proctorSuggestionsMap.clear();
  this.allProctorsMap.clear();
  this.processingCancelled = false;
  
// In precomputeAllProctorSuggestions - keep it simple:
const allInstructors = Array.from(
  new Set(
    this.generatedSchedule
      .map(e => e.INSTRUCTOR ? e.INSTRUCTOR.toUpperCase().trim() : "")
      .filter(i => i) // Only filter empty strings
  )
);

  const CHUNK_SIZE = 25; // Process 25 exams per chunk
  const totalExams = this.generatedSchedule.length;
  const chunks = Math.ceil(totalExams / CHUNK_SIZE);
  
  // Show progress dialog
  Swal.fire({
    title: 'Loading Proctor View',
    html: `
      <div style="text-align: center;">
        <p>Processing exams...</p>
        <div style="margin: 20px 0;">
          <div style="background: #e5e7eb; height: 20px; border-radius: 10px; overflow: hidden;">
            <div id="progressBar" style="background: #3b82f6; height: 100%; width: 0%; transition: width 0.3s;"></div>
          </div>
          <p id="progressText" style="margin-top: 10px; font-size: 14px; color: #6b7280;">0 / ${totalExams} exams</p>
        </div>
      </div>
    `,
    allowOutsideClick: false,
    showConfirmButton: false,
    onOpen: () => {
      Swal.showLoading();
    }
  });
  
  // Process in chunks with real async breaks
  for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
    if (this.processingCancelled) {
      console.log('Processing cancelled');
      break;
    }
    
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalExams);
    const chunk = this.generatedSchedule.slice(start, end);
    
    // Process chunk synchronously (fast)
    this.processProctorChunk(chunk, allInstructors);
    
    // Update progress
    const progress = Math.round((end / totalExams) * 100);
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    if (progressBar) progressBar.style.width = `${progress}%`;
    if (progressText) progressText.textContent = `${end} / ${totalExams} exams`;
    
    // Allow UI to update (real async break)
    if (chunkIndex < chunks - 1) {
      await this.sleep(10); // 10ms break between chunks
    }
  }
  
  Swal.close();
  console.timeEnd('precompute-suggestions');
  console.log(`✓ Pre-computed suggestions for ${this.proctorSuggestionsMap.size} exams`);
}
// 2. OPTIMIZED: Pre-compute with real chunking and progress feedback



private processProctorChunk(chunk: ScheduledExam[], allInstructors: string[]) {
  chunk.forEach(exam => {
    const key = exam.CODE;
    const examSubject = exam.SUBJECT_ID ? exam.SUBJECT_ID.toUpperCase().trim() : "";
    const examDept = exam.DEPT ? exam.DEPT.toUpperCase().trim() : "";
    const currentProctor = exam.PROCTOR ? exam.PROCTOR.toUpperCase().trim() : "";

    const sameSubject: string[] = [];
    const sameDept: string[] = [];
    const available: string[] = [];
    const allAvailable: string[] = [];
    
    // Pre-filter busy proctors for this slot
    const busyProctors = new Set<string>();
    this.generatedSchedule.forEach(e => {
      if (e !== exam && 
          e.DAY === exam.DAY && 
          e.SLOT === exam.SLOT && 
          e.PROCTOR) {
        const p = e.PROCTOR.toUpperCase().trim();
        if (p !== currentProctor) {
          busyProctors.add(p);
        }
      }
    });
    
    // Categorize available instructors
    // In processProctorChunk - remove the "Unassigned" check:
allInstructors.forEach(instructor => {
  if (busyProctors.has(instructor)) return;
  
  allAvailable.push(instructor);
      
      const instructorDept = this.instructorDepartments.get(instructor) || '';
      const instructorSubjects = this.instructorSubjects.get(instructor) || new Set();
      
      if (examSubject && instructorSubjects.has(examSubject)) {
        sameSubject.push(instructor);
      } else if (examDept && instructorDept === examDept) {
        sameDept.push(instructor);
      } else {
        available.push(instructor);
      }
    });
    
    // Store results
    this.proctorSuggestionsMap.set(key, {
      sameSubject: sameSubject.sort(),
      sameDept: sameDept.sort(),
      available: available.sort()
    });
    
    this.allProctorsMap.set(key, 
      allAvailable.length > 0 ? allAvailable.sort() : ['No available instructor']
    );
  });
}

// Helper: Process a chunk of exams (synchronous for speed)

// Helper: Real async sleep
private sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}






// 8. Execute assignment (optimized - only updates affected slot)






// 3. Get suggestions (instant - returns cached data)
// getSmartProctorSuggestions(exam: ScheduledExam): {
//   sameSubject: string[];
//   sameDept: string[];
//   available: string[];
// } {
//   const cached = this.proctorSuggestionsMap.get(exam.CODE);
//   return cached || { sameSubject: [], sameDept: [], available: [] };
// }

getSmartProctorSuggestions(exam: ScheduledExam): {
  sameSubject: string[];
  sameDept: string[];
  available: string[];
} {
  const cached = this.proctorSuggestionsMap.get(exam.CODE);
  if (!cached) return { sameSubject: [], sameDept: [], available: [] };
  
  const currentProctor = exam.PROCTOR ? exam.PROCTOR.toUpperCase().trim() : '';
  
  // Filter out "Unassigned" from suggestions
  const filterValid = (list: string[]) => {
    return list.filter(p => {
      if (!p) return false;
      const pUpper = p.toUpperCase().trim();
      
      // Keep if it's the current proctor
      if (pUpper === currentProctor) return true;
      
      // Filter out "Unassigned" variants
      return pUpper !== 'UNASSIGNED' && 
             pUpper !== '(UNASSIGNED)' &&
             pUpper !== 'TBD';
    });
  };
  
  return {
    sameSubject: filterValid(cached.sameSubject),
    sameDept: filterValid(cached.sameDept),
    available: filterValid(cached.available)
  };
}

// 4. Get all proctors (instant - returns cached data)
// getAllProctorsForDropdown(exam: ScheduledExam): string[] {
//   const cached = this.allProctorsMap.get(exam.CODE);
//   return cached || ['No available instructor'];
// }

getAllProctorsForDropdown(exam: ScheduledExam): string[] {
  const cached = this.allProctorsMap.get(exam.CODE);
  if (!cached) return ['No available instructor'];
  
  // ⭐ Filter out "Unassigned" from NEW selections only
  // But if the exam already has "Unassigned" as current proctor, keep it
  const currentProctor = exam.PROCTOR ? exam.PROCTOR.toUpperCase().trim() : '';
  
  const validProctors = cached.filter(p => {
    if (!p) return false;
    const pUpper = p.toUpperCase().trim();
    
    // Allow current proctor even if it's "Unassigned"
    if (pUpper === currentProctor) return true;
    
    // Filter out "Unassigned" for new selections
    return pUpper !== 'UNASSIGNED' && 
           pUpper !== '(UNASSIGNED)' &&
           pUpper !== 'TBD';
  });
  
  return validProctors.length > 0 ? validProctors : ['No available instructor'];
}

// 5. Simple getters
getInstructorSubjects(instructor: string): string[] {
  if (!instructor) return [];
  const instructorUpper = instructor.toUpperCase().trim();
  const subjects = this.instructorSubjects.get(instructorUpper);
  return subjects ? Array.from(subjects).sort() : [];
}

getInstructorDepartment(instructor: string): string {
  if (!instructor) return 'Unknown';
  const instructorUpper = instructor.toUpperCase().trim();
  return this.instructorDepartments.get(instructorUpper) || 'Unknown';
}

get uniqueInstructorDepartments(): string[] {
  return Array.from(new Set(Array.from(this.instructorDepartments.values()))).sort();
}

get uniqueSubjectsTaught(): string[] {
  const allSubjects = new Set<string>();
  this.instructorSubjects.forEach(subjects => {
    subjects.forEach(subject => allSubjects.add(subject));
  });
  return Array.from(allSubjects).sort();
}

// 6. OPTIMIZED: Compute filtered list (debounced)
private filterDebounceTimer: any;

computeFilteredProctorList() {
  // Clear existing timer
  // if (this.filterDebounceTimer) {
  //   clearTimeout(this.filterDebounceTimer);
  // }
  
  // // Debounce filtering by 300ms
  // this.filterDebounceTimer = setTimeout(() => {
  //   this.executeFiltering();
  // }, 300);
   this.executeFiltering();
  this.cd.detectChanges(); // Force UI update
}

private executeFiltering() {
  if (!this.generatedSchedule || this.generatedSchedule.length === 0) {
    this._filteredProctorList = [];
    return;
  }
  
  console.time('filter-exams');
  
  let filtered = this.generatedSchedule;
  
  const query = (this.proctorSearchQuery || '').toLowerCase().trim();
  if (query) {
    filtered = filtered.filter(exam => {
      const searchable = [
        exam.CODE,
        exam.DESCRIPTIVE_TITLE,
        exam.COURSE,
        exam.INSTRUCTOR,
        exam.PROCTOR,
        exam.ROOM,
        exam.DAY,
        exam.SUBJECT_ID
      ]
        .map(s => (s ? s.toString().toLowerCase() : ""))
        .join(" ");
      
      return searchable.includes(query);
    });
  }
  
  if (this.selectedProctorDept) {
    const deptQuery = this.selectedProctorDept.toUpperCase().trim();
    filtered = filtered.filter(exam =>
      exam.DEPT_SUB ? exam.DEPT_SUB.toUpperCase().trim() === deptQuery : false
    );
  }
  if (this.selectedSubjectDept) {
    const deptQuery = this.selectedSubjectDept.toUpperCase().trim();
    filtered = filtered.filter(exam =>
      exam.DEPT ? exam.DEPT.toUpperCase().trim() === deptQuery : false
    );
  }
  if (this.selectedProctorSubject) {
    const subjectQuery = this.selectedProctorSubject.toUpperCase();
    filtered = filtered.filter(exam =>
      exam.SUBJECT_ID ? exam.SUBJECT_ID.toUpperCase().includes(subjectQuery) : false
    );
  }
  
  this._filteredProctorList = filtered;
  console.timeEnd('filter-exams');
  console.log(`Filtered: ${filtered.length} / ${this.generatedSchedule.length} exams`);
}

// get filteredProctorListEnhanced(): ScheduledExam[] {
//   console.log('Getting filtered list, length:', this._filteredProctorList.length);
//   return this._filteredProctorList;
// }

get filteredProctorListEnhanced(): ScheduledExam[] {
  console.log('Getting filtered list, length:', this._filteredProctorList.length);
  
  // Filter out duplicate multi-slot entries (show only first slot)
  const uniqueExams = this._filteredProctorList.filter(exam => 
    !exam.IS_MULTI_SLOT || exam.SLOT_INDEX === 0
  );
  
  return uniqueExams;
}

// 7. OPTIMIZED: Assign proctor (only updates affected slot)
assignProctorSmart(exam: ScheduledExam, proctor: string) {
  // ⭐ NEW: Prevent assigning "Unassigned" or "TBD"
  const proctorUpper = proctor ? proctor.toUpperCase().trim() : '';
  
  if (!proctor || 
      proctor === 'No available instructor' || 
      proctor === '' ||
      proctorUpper === 'UNASSIGNED' ||
      proctorUpper === '(UNASSIGNED)' ||
      proctorUpper === 'TBD') {
    this.showToast('Error', 'Cannot assign "Unassigned" or "TBD" as proctor. Please select a valid instructor.', 'destructive');
    return;
  }
  
  const previousProctor = exam.PROCTOR;
  
  const conflict = this.generatedSchedule.find(e =>
    e !== exam &&
    e.DAY === exam.DAY &&
    e.SLOT === exam.SLOT &&
    e.PROCTOR &&
    e.PROCTOR.toUpperCase().trim() === proctorUpper
  );
  
  if (conflict) {
    Swal.fire({
      title: 'Conflict Warning',
      type: 'warning',
      html: `
        <div style="text-align: left; padding: 15px;">
          <p style="margin-bottom: 15px;"><strong>${proctor}</strong> is already proctoring:</p>
          <div style="background: #fee2e2; padding: 12px; border-radius: 8px; border-left: 4px solid #ef4444;">
            <p style="margin: 0;"><strong>${conflict.CODE}</strong> - ${conflict.DESCRIPTIVE_TITLE}</p>
            <p style="margin: 8px 0 0 0; font-size: 14px; color: #6b7280;">
              ${conflict.COURSE} | Room ${conflict.ROOM}
            </p>
          </div>
          <p style="margin-top: 15px; color: #ef4444; font-weight: 600;">Assign anyway?</p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Yes, assign anyway',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#ef4444'
    }).then((result) => {
      if (result.value) {
        this.executeProctorAssignment(exam, proctor);
      } else {
        exam.PROCTOR = previousProctor;
        this.cd.detectChanges();
      }
    });
  } else {
    this.executeProctorAssignment(exam, proctor);
  }
}

// 8. Execute assignment (optimized - only updates affected slot)
private executeProctorAssignment(exam: ScheduledExam, proctor: string) {
  exam.PROCTOR = proctor;
  exam.HAS_CONFLICT = false;
  
  // Only update suggestions for affected time slot (much faster)
  this.updateSuggestionsForTimeSlot(exam.DAY, exam.SLOT);
    this.detectProctorConflicts();

  const proctorSubjects = this.getInstructorSubjects(proctor);
  const examSubject = exam.SUBJECT_ID || '';
  
  let matchIcon = '✓';
  if (proctorSubjects.includes(examSubject)) {
    matchIcon = '🎯';
  } else if (this.getInstructorDepartment(proctor) === exam.DEPT) {
    matchIcon = '🏛️';
  }
  
  this.showToast('Proctor Assigned', `${matchIcon} ${proctor} → ${exam.CODE}`, 'success');
  this.autoSaveToLocalStorage();
  this.cd.detectChanges();
}

// 9. OPTIMIZED: Update only affected slot (much faster than full recompute)
private updateSuggestionsForTimeSlot(day: string, slot: string) {
  const affectedExams = this.generatedSchedule.filter(e => 
    e.DAY === day && e.SLOT === slot
  );
  
  const allInstructors = Array.from(
    new Set(
      this.generatedSchedule
        .map(e => e.INSTRUCTOR ? e.INSTRUCTOR.toUpperCase().trim() : "")
        .filter(i => i)
    )
  );

  // Process affected exams only
  this.processProctorChunk(affectedExams, allInstructors);
}

// 10. OPTIMIZED: Auto-assign with progress
async autoAssignAllProctors() {
  console.log('=== Auto-Assigning All Proctors ===');
  
  if (!this.generatedSchedule || this.generatedSchedule.length === 0) {
    this.showToast('Error', 'No exams to assign', 'destructive');
    return;
  }

  if (!this.instructorSubjects || this.instructorSubjects.size === 0) {
    this.initializeInstructorData();
  }

  Swal.fire({
    title: 'Auto-Assigning Proctors',
    text: 'Please wait...',
    allowOutsideClick: false,
    onOpen: () => {
      Swal.showLoading();
    }
  });

  // Small delay to show loading
  await this.sleep(100);

  let stats = {
    assigned: 0,
    conflict: 0,
    sameSubject: 0,
    sameDept: 0,
    perfect: 0
  };
  
  this.generatedSchedule.forEach(exam => {
    exam.PROCTOR = '';
    exam.HAS_CONFLICT = false;
  });

  const examsBySlot: { [key: string]: ScheduledExam[] } = {};
  this.generatedSchedule.forEach(exam => {
    const key = `${exam.DAY}|${exam.SLOT}`;
    if (!examsBySlot[key]) examsBySlot[key] = [];
    examsBySlot[key].push(exam);
  });

 const allInstructors = Array.from(
  new Set(
    this.generatedSchedule
      .map(e => e.INSTRUCTOR ? e.INSTRUCTOR.toUpperCase().trim() : "")
      .filter(i => {
        if (!i) return false;
        const upper = i.toUpperCase().trim();
        return upper !== 'UNASSIGNED' && 
               upper !== '(UNASSIGNED)' && 
               upper !== 'TBD' ;
      })
  )
);

  Object.values(examsBySlot).forEach(examsInSlot => {
    const busyProctors = new Set<string>();

    examsInSlot.forEach(exam => {

        // ⭐ NEW: If this is a continuation of a multi-slot exam, use the same proctor
  if (exam.IS_MULTI_SLOT && exam.SLOT_INDEX > 0) {
    // Find the first slot of this exam
    const firstSlotExam = this.generatedSchedule.find(e => 
      e.CODE === exam.CODE && 
      e.IS_MULTI_SLOT && 
      e.SLOT_INDEX === 0
    );
    
    if (firstSlotExam && firstSlotExam.PROCTOR) {
      exam.PROCTOR = firstSlotExam.PROCTOR;
      stats.assigned++;
      return; // Skip normal assignment logic
    }
  }

      const examSubject = exam.SUBJECT_ID ? exam.SUBJECT_ID.toUpperCase().trim() : "";
      const examDept = exam.DEPT ? exam.DEPT.toUpperCase().trim() : "";
      const instructorUpper = exam.INSTRUCTOR ? exam.INSTRUCTOR.toUpperCase().trim() : "";


      if (!instructorUpper || 
      instructorUpper === 'UNASSIGNED' || 
      instructorUpper === '(UNASSIGNED)' ||
      instructorUpper === 'TBD') {
    exam.PROCTOR = 'TBD';
    exam.HAS_CONFLICT = true;
    stats.conflict++;
    return; // Skip to next exam
  }


      if (!busyProctors.has(instructorUpper)) {
        exam.PROCTOR = exam.INSTRUCTOR;
        busyProctors.add(instructorUpper);
        stats.assigned++;
        stats.perfect++;
        return;
      }

      let bestProctor = null;
      let matchType = '';
      
      for (const instructor of allInstructors) {
        if (busyProctors.has(instructor)) continue;
        
        const instructorDept = this.instructorDepartments.get(instructor) || '';
        const instructorSubjects = this.instructorSubjects.get(instructor) || new Set();
        
        if (examSubject && instructorSubjects.has(examSubject) && instructorDept === examDept) {
          bestProctor = instructor;
          matchType = 'perfect';
          break;
        }
        
        if (!bestProctor && examSubject && instructorSubjects.has(examSubject)) {
          bestProctor = instructor;
          matchType = 'subject';
        }
        
        if (!bestProctor && examDept && instructorDept === examDept) {
          bestProctor = instructor;
          matchType = 'dept';
        }
        
        if (!bestProctor) {
          bestProctor = instructor;
          matchType = 'available';
        }
      }
      
      if (bestProctor) {
        exam.PROCTOR = bestProctor;
        busyProctors.add(bestProctor.toUpperCase().trim());
        stats.assigned++;
        if (matchType === 'perfect') stats.perfect++;
        else if (matchType === 'subject') stats.sameSubject++;
        else if (matchType === 'dept') stats.sameDept++;
      } else {
        exam.PROCTOR = 'TBD';
        exam.HAS_CONFLICT = true;
        stats.conflict++;
      }
    });
  });

  await this.precomputeAllProctorSuggestions();
  this.computeFilteredProctorList();
this.detectProctorConflicts();
  Swal.close();

  const message = `
    <div style="text-align: left; padding: 10px;">
      <p><strong>✓ Auto-Assignment Complete!</strong></p>
      <ul style="margin: 10px 0; padding-left: 20px;">
        <li>Total Assigned: <strong>${stats.assigned}</strong> / ${this.generatedSchedule.length}</li>
        <li>🎯🎯 Perfect Match: <strong>${stats.perfect}</strong></li>
        <li>🎯 Same Subject: <strong>${stats.sameSubject}</strong></li>
        <li>🏛️ Same Dept: <strong>${stats.sameDept}</strong></li>
        <li>⚠️ Needs Manual: <strong>${stats.conflict}</strong></li>
      </ul>
    </div>
  `;

  Swal.fire({
    title: 'Proctors Assigned',
    html: message,
    type: 'success',
    confirmButtonText: 'OK'
  });

  this.autoSaveToLocalStorage();
  this.cd.detectChanges();
}

// 11. Reset all
async resetAllProctors() {
  const result = await Swal.fire({
    title: 'Reset All Proctors?',
    text: 'This will clear all proctor assignments.',
    type: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'Yes, reset all',
    cancelButtonText: 'Cancel'
  });
  
  if (result.value) {
    this.generatedSchedule.forEach(exam => {
      exam.PROCTOR = '';
      exam.HAS_CONFLICT = false;
    });
    
    await this.precomputeAllProctorSuggestions();
    this.computeFilteredProctorList();
    
    this.showToast('Reset Complete', 'All proctor assignments cleared');
    this.autoSaveToLocalStorage();
    this.cd.detectChanges();
  }
}

// 12. OPTIMIZED: View proctor assignments (main entry point)
async viewProctorAssignments() {
  console.log('=== Initializing Proctor View ===');
  console.time('total-init');
  
  // Cancel any ongoing processing
  this.processingCancelled = true;
  await this.sleep(50);
  this.processingCancelled = false;
  
  // Step 1: Initialize instructor data (fast)
  this.initializeInstructorData();
  
  // Step 2: Set default proctors (fast)
  this.generatedSchedule.forEach(exam => {
    if (!exam.PROCTOR || exam.PROCTOR === 'TBD' || exam.PROCTOR === '') {
      exam.PROCTOR = exam.INSTRUCTOR;
    }
    if (exam.HAS_CONFLICT === undefined) {
      exam.HAS_CONFLICT = false;
    }
  });
  
  // Step 3: Pre-compute suggestions (chunked with progress)
  await this.precomputeAllProctorSuggestions();
  
  // Step 4: Set filtered list BEFORE switching view
  this._filteredProctorList = [...this.generatedSchedule];
  
  // Step 5: Switch to proctor view
  this.currentStep = 'proctor';
  
  // Step 6: Force change detection
  this.cd.detectChanges();
  
  // Step 7: Apply filters after view is rendered
  await this.sleep(100);
  this.executeFiltering();
  
  console.timeEnd('total-init');
  console.log('✓ Proctor view ready');
  console.log(`  - ${this.generatedSchedule.length} total exams`);
  console.log(`  - ${this._filteredProctorList.length} displayed`);
  
    this.detectProctorConflicts();
  this.cd.detectChanges();
}

// 13. Clear filters
clearProctorFilters() {
  this.proctorSearchQuery = '';
  this.selectedProctorDept = '';
  this.selectedSubjectDept = '';
  this.selectedProctorSubject = '';
  this.computeFilteredProctorList();
}

// 14. Apply filters (debounced)
applyProctorFilters() {
  this.computeFilteredProctorList();
    this.executeFiltering();
  this.cd.detectChanges();
}

onProctorSearchChange() {
  if (this.filterDebounceTimer) {
    clearTimeout(this.filterDebounceTimer);
  }
  
  this.filterDebounceTimer = setTimeout(() => {
    this.executeFiltering();
    this.cd.detectChanges();
  }, 300);
}
// 15. Toggle suggestions
onSmartSuggestionsToggle(event: any) {
  this.cd.detectChanges();
}

// 16. Track by (important for performance)
trackByExamCode(index: number, exam: ScheduledExam): string {
  return `${exam.CODE}_${exam.DAY}_${exam.SLOT}`;
}

// 17. Statistics (cached)
get totalExams(): number {
  return this.generatedSchedule ? this.generatedSchedule.length : 0;
}

get assignedExams(): number {
  if (!this.generatedSchedule) return 0;
  return this.generatedSchedule.filter(e => 
    e.PROCTOR && e.PROCTOR !== 'TBD' && !e.HAS_CONFLICT
  ).length;
}

get conflictExams(): number {
  if (!this.generatedSchedule) return 0;
  return this.generatedSchedule.filter(e => 
    e.HAS_CONFLICT || !e.PROCTOR || e.PROCTOR === 'TBD'
  ).length;
}

get totalProctors(): number {
  const proctors = new Set<string>();
  if (this.generatedSchedule) {
    this.generatedSchedule.forEach(e => {
      if (e.PROCTOR && e.PROCTOR !== 'TBD') {
        proctors.add(e.PROCTOR.toUpperCase().trim());
      }
    });
  }
  return proctors.size;
}

// 18. CLEANUP: Call this when leaving proctor view or component destroy
cleanupProctorView() {
  this.processingCancelled = true;
  this.proctorSuggestionsMap.clear();
  this.allProctorsMap.clear();
  this._filteredProctorList = [];
  if (this.filterDebounceTimer) {
    clearTimeout(this.filterDebounceTimer);
  }
  console.log('Proctor view cleanup complete');
}

// Add to ngOnDestroy
ngOnDestroy() {
  this.cleanupProctorView();
}


ngAfterViewInit() {
  console.log('View initialized');
  console.log('generatedSchedule:', this.generatedSchedule ? this.generatedSchedule.length : 0);
  console.log('filteredProctorListEnhanced:', this.filteredProctorListEnhanced ? this.filteredProctorListEnhanced.length : 0);
}


// Get merged time slot for display (used in both Generated and Proctor views)
getMergedSlotForDisplay(exam: ScheduledExam): string {
  // If not multi-slot, return regular slot
  if (!exam.IS_MULTI_SLOT) {
    return exam.SLOT;
  }
  
  // Find all slots for this exam
  const allSlots = this.generatedSchedule
    .filter(e => e.CODE === exam.CODE && e.IS_MULTI_SLOT)
    .sort((a, b) => (a.SLOT_INDEX || 0) - (b.SLOT_INDEX || 0))
    .map(e => e.SLOT);
  
  if (allSlots.length <= 1) {
    return exam.SLOT;
  }
  
  // Merge the time range
  const firstSlot = allSlots[0];
  const lastSlot = allSlots[allSlots.length - 1];
  
  const startTime = firstSlot.split('-')[0].trim();
  const endTime = lastSlot.split('-')[1].trim();
  
  return `${startTime}-${endTime}`;
}



}