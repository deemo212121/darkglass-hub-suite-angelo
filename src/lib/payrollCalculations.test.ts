/**
 * Unit Tests for Pro-Rata Payroll Calculations
 * Tests all major functions with various scenarios
 */

import {
  createSalaryHistory,
  addSalaryChange,
  getEffectiveRate,
  findSalaryChangesInPeriod,
  calculateRegularPay,
  calculateOvertimePay,
  calculateSplitPayroll,
  getDayCount,
  SalaryHistory,
} from './payrollCalculations';

describe('Payroll Calculations', () => {
  describe('createSalaryHistory', () => {
    it('should create initial salary history', () => {
      const history = createSalaryHistory('EMP001', 15, new Date('2024-01-01'));

      expect(history.employeeId).toBe('EMP001');
      expect(history.salaryEntries).toHaveLength(1);
      expect(history.salaryEntries[0].hourlyRate).toBe(15);
      expect(history.salaryEntries[0].reason).toBe('initial');
    });
  });

  describe('addSalaryChange', () => {
    it('should add a promotion to salary history', () => {
      let history = createSalaryHistory('EMP001', 4, new Date('2024-01-01'));
      history = addSalaryChange(
        history,
        new Date('2024-01-06'),
        6,
        'promotion'
      );

      expect(history.salaryEntries).toHaveLength(2);
      expect(history.salaryEntries[1].hourlyRate).toBe(6);
      expect(history.salaryEntries[1].reason).toBe('promotion');
    });

    it('should maintain chronological order after adding changes', () => {
      let history = createSalaryHistory('EMP001', 10, new Date('2024-01-01'));
      history = addSalaryChange(history, new Date('2024-01-20'), 12, 'promotion');
      history = addSalaryChange(history, new Date('2024-01-10'), 11, 'adjustment');

      const dates = history.salaryEntries.map((e) => e.effectiveDate.getTime());
      expect(dates).toEqual([...dates].sort((a, b) => a - b));
    });
  });

  describe('getEffectiveRate', () => {
    it('should return initial rate for date before any changes', () => {
      const history = createSalaryHistory('EMP001', 15, new Date('2024-01-01'));
      const rate = getEffectiveRate(history, new Date('2024-01-05'));

      expect(rate).toBe(15);
    });

    it('should return updated rate after salary change', () => {
      let history = createSalaryHistory('EMP001', 4, new Date('2024-01-01'));
      history = addSalaryChange(history, new Date('2024-01-06'), 6, 'promotion');

      const rateBefore = getEffectiveRate(history, new Date('2024-01-05'));
      const rateAfter = getEffectiveRate(history, new Date('2024-01-06'));

      expect(rateBefore).toBe(4);
      expect(rateAfter).toBe(6);
    });

    it('should throw error for date before first entry', () => {
      const history = createSalaryHistory('EMP001', 15, new Date('2024-01-05'));

      expect(() => {
        getEffectiveRate(history, new Date('2024-01-01'));
      }).toThrow();
    });
  });

  describe('findSalaryChangesInPeriod', () => {
    it('should find salary changes within period', () => {
      let history = createSalaryHistory('EMP001', 4, new Date('2024-01-01'));
      history = addSalaryChange(history, new Date('2024-01-06'), 6, 'promotion');
      history = addSalaryChange(history, new Date('2024-01-15'), 7, 'promotion');

      const changes = findSalaryChangesInPeriod(
        history,
        new Date('2024-01-01'),
        new Date('2024-01-10')
      );

      expect(changes).toHaveLength(1);
      expect(changes[0].hourlyRate).toBe(6);
    });

    it('should not include changes outside period boundaries', () => {
      let history = createSalaryHistory('EMP001', 4, new Date('2024-01-01'));
      history = addSalaryChange(history, new Date('2024-01-01'), 4, 'initial');
      history = addSalaryChange(history, new Date('2024-01-15'), 6, 'promotion');

      const changes = findSalaryChangesInPeriod(
        history,
        new Date('2024-01-02'),
        new Date('2024-01-14')
      );

      expect(changes).toHaveLength(0);
    });
  });

  describe('calculateRegularPay', () => {
    it('should calculate regular pay without overtime', () => {
      const pay = calculateRegularPay(40, 15);
      expect(pay).toBe(600);
    });

    it('should not include overtime hours in regular pay', () => {
      const pay = calculateRegularPay(50, 20);
      expect(pay).toBe(800); // 40 * 20, not 50 * 20
    });

    it('should handle decimal rates', () => {
      const pay = calculateRegularPay(40, 12.5);
      expect(pay).toBe(500);
    });

    it('should round to 2 decimal places', () => {
      const pay = calculateRegularPay(37.33, 7.77);
      expect(pay).toBe(290.02);
    });
  });

  describe('calculateOvertimePay', () => {
    it('should return 0 for hours under 40', () => {
      const pay = calculateOvertimePay(40, 15);
      expect(pay).toBe(0);
    });

    it('should calculate overtime pay at 1.5x rate', () => {
      const pay = calculateOvertimePay(50, 20);
      expect(pay).toBe(300); // 10 * 20 * 1.5
    });

    it('should handle decimal calculations correctly', () => {
      const pay = calculateOvertimePay(45, 15);
      expect(pay).toBe(112.5); // 5 * 15 * 1.5
    });

    it('should return 0 if no overtime', () => {
      const pay = calculateOvertimePay(30, 20);
      expect(pay).toBe(0);
    });
  });

  describe('getDayCount', () => {
    it('should calculate days between dates correctly', () => {
      const start = new Date('2024-01-01');
      const end = new Date('2024-01-10');
      const days = getDayCount(start, end);

      expect(days).toBe(9);
    });

    it('should handle same day (0 difference)', () => {
      const date = new Date('2024-01-01');
      const days = getDayCount(date, date);

      expect(days).toBe(0);
    });
  });

  describe('calculateSplitPayroll', () => {
    it('should handle payroll with no salary changes', () => {
      const history = createSalaryHistory('EMP001', 15, new Date('2024-01-01'));

      const breakdown = calculateSplitPayroll(
        'EMP001',
        history,
        new Date('2024-01-01'),
        new Date('2024-01-10'),
        40
      );

      expect(breakdown.portions).toHaveLength(1);
      expect(breakdown.totalPay).toBe(600); // 40 * 15
      expect(breakdown.salaryChangeOccurred).toBe(false);
    });

    it('should handle payroll with mid-period promotion', () => {
      let history = createSalaryHistory('EMP001', 4, new Date('2024-01-01'));
      history = addSalaryChange(history, new Date('2024-01-06'), 6, 'promotion');

      const breakdown = calculateSplitPayroll(
        'EMP001',
        history,
        new Date('2024-01-01'),
        new Date('2024-01-10'),
        40
      );

      expect(breakdown.portions).toHaveLength(2);
      expect(breakdown.salaryChangeOccurred).toBe(true);
      expect(breakdown.totalPay).toBe(200); // 20*4 + 20*6
    });

    it('should correctly distribute hours in split payroll', () => {
      let history = createSalaryHistory('EMP001', 10, new Date('2024-01-01'));
      history = addSalaryChange(history, new Date('2024-01-06'), 15, 'promotion');

      const breakdown = calculateSplitPayroll(
        'EMP001',
        history,
        new Date('2024-01-01'),
        new Date('2024-01-10'),
        40
      );

      // 40 hours over 10 days = 4 hours/day
      // Days 1-5 = 20 hours, Days 6-10 = 20 hours
      expect(breakdown.portions[0].hoursWorked).toBeCloseTo(20, 1);
      expect(breakdown.portions[1].hoursWorked).toBeCloseTo(20, 1);
      expect(breakdown.totalRegularPay).toBe(500); // 20*10 + 20*15
    });

    it('should calculate overtime correctly in split periods', () => {
      let history = createSalaryHistory('EMP002', 15, new Date('2024-01-01'));
      history = addSalaryChange(history, new Date('2024-01-05'), 20, 'promotion');

      const breakdown = calculateSplitPayroll(
        'EMP002',
        history,
        new Date('2024-01-01'),
        new Date('2024-01-10'),
        50
      );

      // 50 hours over 10 days = 5 hours/day
      // Days 1-4: 20 hours at $15 = $300 (no OT in this part)
      // Days 5-10: 30 hours at $20 = $600 + 10 * $20 * 1.5 = $900 total for part 2
      // Total: $1200

      expect(breakdown.portions).toHaveLength(2);
      expect(breakdown.totalPay).toBeCloseTo(1200, 0);
    });

    it('should handle multiple salary changes in one period', () => {
      let history = createSalaryHistory('EMP003', 12, new Date('2024-01-01'));
      history = addSalaryChange(history, new Date('2024-01-04'), 14, 'promotion');
      history = addSalaryChange(history, new Date('2024-01-08'), 16, 'promotion');

      const breakdown = calculateSplitPayroll(
        'EMP003',
        history,
        new Date('2024-01-01'),
        new Date('2024-01-10'),
        40
      );

      expect(breakdown.portions).toHaveLength(3);
      expect(breakdown.salaryChangeOccurred).toBe(true);
    });

    it('should aggregate totals correctly', () => {
      let history = createSalaryHistory('EMP001', 4, new Date('2024-01-01'));
      history = addSalaryChange(history, new Date('2024-01-06'), 6, 'promotion');

      const breakdown = calculateSplitPayroll(
        'EMP001',
        history,
        new Date('2024-01-01'),
        new Date('2024-01-10'),
        40
      );

      const sumOfParts = breakdown.portions.reduce((sum, p) => sum + p.totalPay, 0);
      expect(breakdown.totalPay).toBe(sumOfParts);
    });

    it('should handle demotion (rate decrease)', () => {
      let history = createSalaryHistory('EMP004', 25, new Date('2024-01-01'));
      history = addSalaryChange(history, new Date('2024-01-06'), 18, 'demotion');

      const breakdown = calculateSplitPayroll(
        'EMP004',
        history,
        new Date('2024-01-01'),
        new Date('2024-01-10'),
        45
      );

      expect(breakdown.portions[0].hourlyRate).toBe(25);
      expect(breakdown.portions[1].hourlyRate).toBe(18);
      expect(breakdown.salaryChangeOccurred).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    it('should calculate Example 1 correctly (basic promotion)', () => {
      let history = createSalaryHistory('EMP001', 4, new Date('2024-01-01'));
      history = addSalaryChange(history, new Date('2024-01-06'), 6, 'promotion');

      const breakdown = calculateSplitPayroll(
        'EMP001',
        history,
        new Date('2024-01-01'),
        new Date('2024-01-10'),
        40
      );

      expect(breakdown.totalPay).toBe(200); // 20*4 + 20*6 = 80 + 120 = 200
      expect(breakdown.totalRegularPay).toBe(200);
      expect(breakdown.totalOvertimePay).toBe(0);
    });

    it('should calculate with realistic weekly payroll', () => {
      let history = createSalaryHistory('EMP005', 18.5, new Date('2024-01-08'));
      history = addSalaryChange(history, new Date('2024-01-17'), 22, 'promotion');

      const breakdown = calculateSplitPayroll(
        'EMP005',
        history,
        new Date('2024-01-08'),
        new Date('2024-01-21'),
        80
      );

      // 2 weeks = 80 hours
      // Week 1 (5 days): 40 hours @ $18.50 = $740
      // Week 2 (5 days): 40 hours, but first 2 days @ $18.50 = 16 hrs, last 3 days @ $22 = 24 hrs
      // Week 2: 16 * $18.50 = $296 + 24 * $22 = $528 = $824
      // Total: $740 + $824 = $1564

      expect(breakdown.salaryChangeOccurred).toBe(true);
      expect(breakdown.portions).toHaveLength(2);
    });
  });
});

/**
 * Manual test runner for debugging
 */
export function runTests(): void {
  console.log('Running Payroll Calculation Tests...\n');

  // Test 1: Basic History Creation
  try {
    const history = createSalaryHistory('EMP001', 15, new Date('2024-01-01'));
    console.log('✓ Test 1: Salary history creation - PASSED');
  } catch (e) {
    console.log('✗ Test 1: Salary history creation - FAILED', e);
  }

  // Test 2: Effective Rate Calculation
  try {
    let history = createSalaryHistory('EMP001', 4, new Date('2024-01-01'));
    history = addSalaryChange(history, new Date('2024-01-06'), 6, 'promotion');

    const rateBefore = getEffectiveRate(history, new Date('2024-01-05'));
    const rateAfter = getEffectiveRate(history, new Date('2024-01-06'));

    if (rateBefore === 4 && rateAfter === 6) {
      console.log('✓ Test 2: Effective rate calculation - PASSED');
    } else {
      console.log('✗ Test 2: Effective rate calculation - FAILED');
    }
  } catch (e) {
    console.log('✗ Test 2: Effective rate calculation - FAILED', e);
  }

  // Test 3: Split Payroll Calculation
  try {
    let history = createSalaryHistory('EMP001', 4, new Date('2024-01-01'));
    history = addSalaryChange(history, new Date('2024-01-06'), 6, 'promotion');

    const breakdown = calculateSplitPayroll(
      'EMP001',
      history,
      new Date('2024-01-01'),
      new Date('2024-01-10'),
      40
    );

    if (breakdown.totalPay === 200 && breakdown.portions.length === 2) {
      console.log('✓ Test 3: Split payroll calculation - PASSED');
    } else {
      console.log(
        '✗ Test 3: Split payroll calculation - FAILED',
        `Expected 200, got ${breakdown.totalPay}`
      );
    }
  } catch (e) {
    console.log('✗ Test 3: Split payroll calculation - FAILED', e);
  }

  console.log('\nTests completed!');
}
