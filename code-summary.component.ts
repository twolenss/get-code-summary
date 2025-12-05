import { Component, OnInit } from '@angular/core';
import { ApiService } from '../api.service';
import { GlobalService } from '../global.service';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import { ExcelService } from '../services/excel.service';

export interface CodeSummary {
  codeNo: string;
  version: string;
  subjectId: string;
  subjectTitle: string;
  course: string;
  deptCode: string
  yearLevel: string;
  setNo: string;
  lecUnits: string;
  labUnits: string;
  time: string;
  day: string;
  roomNumber: string;
  instructor: string;
  oe: string;
  dept: string;
  roomCampusLocation: string;
}

@Component({
  selector: 'app-code-summary',
  templateUrl: './code-summary.component.html',
  styleUrls: ['./code-summary.component.scss']
})
export class CodeSummaryComponent implements OnInit {

  rawCodes: CodeSummary[] = [];       // original API data
  filteredCodes: CodeSummary[] = [];  // data shown in table

  columnFilters: { [key: string]: string } = {}; // track column filters

  constructor(
    public api: ApiService,
    public global: GlobalService,
    private excelService: ExcelService
  ) {}

  ngOnInit() {
    const schoolYear = this.global.syear;
    this.getCodeSummaryReport(schoolYear);
  }

  getCodeSummaryReport(sy: string) {
    this.api.getCodeSummaryReport(sy)
      .map((response: any) => response.json())
      .subscribe(
        res => {
          this.rawCodes = res.data;
          this.filteredCodes = res.data;  // show all initially ✔
          Swal.close();
        },
        err => this.global.swalAlertError(err)
      );
  }

  applyColumnFilter(column: string, event: Event) {
    const filterValue = (event.target as HTMLInputElement).value.toLowerCase();
    this.columnFilters[column] = filterValue;

    this.filteredCodes = this.rawCodes.filter(row => {
      return Object.keys(this.columnFilters).every(col => {
        const filterText = this.columnFilters[col];

        if (!filterText) return true;
        const rowVal = row[col];

        if (rowVal === null || rowVal === undefined) return false;

        return rowVal.toString().toLowerCase().includes(filterText);
      });
    });
  }

  // Export to Excel
  exportAsXLSX(): void {
    const array = this.rawCodes.map(item => ({
      'CODE': item.codeNo,
      'VERSION': item.version,
      'SUBJECT ID': item.subjectId,
      'DESCRIPTIVE TITLE': item.subjectTitle,
      'COURSE': item.course,
      'DEPTCODE': item.deptCode,
      'YEAR LEVEL': item.yearLevel,
      'SET NO': item.setNo,
      'LEC': item.lecUnits,
      'LAB': item.labUnits,
      'TIME': item.time,
      'DAY': item.day,
      'ROOM': item.roomNumber,
      'INSTRUCTOR': item.instructor,
      'OE': item.oe,
      'DEPT': item.dept,
      'CAMPUS': item.roomCampusLocation
    }));

    this.excelService.exportAsExcelFile(array, 'ExamSchedule-list');
  }

}
