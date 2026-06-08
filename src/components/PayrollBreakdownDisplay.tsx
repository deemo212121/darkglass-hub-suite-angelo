import React from 'react';
import { SplitPayrollBreakdown, PayrollPeriodPortion } from '../lib/payrollCalculations';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';

interface PayrollBreakdownDisplayProps {
  breakdown: SplitPayrollBreakdown;
}

/**
 * Component to display split payroll breakdown with salary changes
 */
export const PayrollBreakdownDisplay: React.FC<PayrollBreakdownDisplayProps> = ({
  breakdown,
}) => {
  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  return (
    <div className="w-full space-y-4">
      {/* Header Summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Payroll Breakdown</CardTitle>
              <CardDescription>
                {formatDate(breakdown.payPeriodStart)} to{' '}
                {formatDate(breakdown.payPeriodEnd)}
              </CardDescription>
            </div>
            {breakdown.salaryChangeOccurred && (
              <Badge variant="outline" className="bg-blue-50">
                Mid-Period Change
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Hours</p>
              <p className="text-2xl font-bold">
                {breakdown.totalHoursWorked.toFixed(1)}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Regular Pay</p>
              <p className="text-2xl font-bold text-green-600">
                {formatCurrency(breakdown.totalRegularPay)}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Overtime Pay</p>
              <p className="text-2xl font-bold text-orange-600">
                {formatCurrency(breakdown.totalOvertimePay)}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Total Pay</p>
              <p className="text-2xl font-bold text-blue-600">
                {formatCurrency(breakdown.totalPay)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Period Portions */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Period Breakdown</h3>

        {breakdown.portions.map((portion, index) => (
          <PeriodPortionCard key={index} portion={portion} index={index} />
        ))}
      </div>

      {/* Calculation Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calculation Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4">
              {breakdown.portions.map((portion, idx) => (
                <div key={idx} className="border rounded p-3 bg-gray-50">
                  <p className="font-medium text-gray-900 mb-2">
                    {portion.periodName}
                  </p>
                  <ul className="space-y-1 text-gray-700">
                    <li>
                      Hours: <span className="font-semibold">{portion.hoursWorked.toFixed(2)}</span>
                    </li>
                    <li>
                      Rate: <span className="font-semibold">${portion.hourlyRate.toFixed(2)}/hr</span>
                    </li>
                    <li>
                      Regular: <span className="font-semibold">${portion.regularPay.toFixed(2)}</span>
                    </li>
                    {portion.overtimePay ? (
                      <li>
                        Overtime: <span className="font-semibold">${portion.overtimePay.toFixed(2)}</span>
                      </li>
                    ) : null}
                    <li className="pt-1 border-t border-gray-300">
                      Total: <span className="font-bold">${portion.totalPay.toFixed(2)}</span>
                    </li>
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

/**
 * Component for individual period portion card
 */
const PeriodPortionCard: React.FC<{
  portion: PayrollPeriodPortion;
  index: number;
}> = ({ portion, index }) => {
  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const getBadgeColor = (index: number): string => {
    return index === 0 ? 'bg-purple-50' : 'bg-green-50';
  };

  return (
    <Card className={`border-l-4 ${index === 0 ? 'border-l-purple-500' : 'border-l-green-500'}`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h4 className="font-semibold text-gray-900">{portion.periodName}</h4>
            <p className="text-sm text-gray-500">
              {portion.startDate.toLocaleDateString()} to{' '}
              {portion.endDate.toLocaleDateString()}
            </p>
          </div>
          <Badge className={getBadgeColor(index)}>
            {index === 0 ? 'Original Rate' : 'New Rate'}
          </Badge>
        </div>

        <div className="grid grid-cols-6 gap-2 text-sm">
          <div>
            <p className="text-gray-600 text-xs font-medium">HOURS</p>
            <p className="text-lg font-bold text-gray-900">
              {portion.hoursWorked.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-gray-600 text-xs font-medium">RATE</p>
            <p className="text-lg font-bold text-gray-900">
              ${portion.hourlyRate.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-gray-600 text-xs font-medium">REGULAR</p>
            <p className="text-lg font-bold text-green-600">
              {formatCurrency(portion.regularPay)}
            </p>
          </div>
          {portion.overtimePay ? (
            <>
              <div>
                <p className="text-gray-600 text-xs font-medium">OT HOURS</p>
                <p className="text-lg font-bold text-orange-600">
                  {(portion.hoursWorked - 40).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-gray-600 text-xs font-medium">OT RATE</p>
                <p className="text-lg font-bold text-orange-600">
                  ${(portion.hourlyRate * 1.5).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-gray-600 text-xs font-medium">OVERTIME</p>
                <p className="text-lg font-bold text-orange-600">
                  {formatCurrency(portion.overtimePay)}
                </p>
              </div>
            </>
          ) : (
            <div className="col-span-3"></div>
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between">
          <span className="font-medium text-gray-900">Period Total:</span>
          <span className="text-lg font-bold text-blue-600">
            {formatCurrency(portion.totalPay)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
