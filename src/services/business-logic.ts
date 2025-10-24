import { pythonRunner, PythonScriptResult } from '@/lib/python-runner';

export interface DataAnalysisResult {
  totalSales: number;
  averageOrderValue: number;
  topProducts: Array<{
    name: string;
    sales: number;
  }>;
  trends: Array<{
    date: string;
    value: number;
  }>;
}

export interface PredictionResult {
  predictedValue: number;
  confidence: number;
  factors: string[];
}

export interface DataProcessingResult {
  processedRecords: number;
  errors: string[];
  summary: Record<string, any>;
}

export class BusinessLogicService {
  /**
   * Analyze sales data using Python
   */
  async analyzeSalesData(
    data: any[]
  ): Promise<PythonScriptResult<DataAnalysisResult>> {
    return await pythonRunner.runScript('analyze_sales.py', [
      '--data',
      JSON.stringify(data)
    ]);
  }

  /**
   * Generate predictions using Python ML
   */
  async generatePrediction(
    inputData: Record<string, any>
  ): Promise<PythonScriptResult<PredictionResult>> {
    return await pythonRunner.runScript('predict.py', [
      '--input',
      JSON.stringify(inputData)
    ]);
  }

  /**
   * Process and clean data
   */
  async processData(
    rawData: any[]
  ): Promise<PythonScriptResult<DataProcessingResult>> {
    return await pythonRunner.runScript('process_data.py', [
      '--data',
      JSON.stringify(rawData)
    ]);
  }

  /**
   * Run custom Python code
   */
  async runCustomAnalysis(
    code: string,
    data?: any
  ): Promise<PythonScriptResult> {
    const args = data ? ['--data', JSON.stringify(data)] : [];
    return await pythonRunner.runCode(code, args);
  }

  /**
   * Calculate financial metrics
   */
  async calculateFinancialMetrics(
    transactions: any[]
  ): Promise<PythonScriptResult> {
    return await pythonRunner.runScript('financial_calculator.py', [
      '--transactions',
      JSON.stringify(transactions)
    ]);
  }

  /**
   * Generate reports
   */
  async generateReport(
    reportType: string,
    data: any
  ): Promise<PythonScriptResult> {
    return await pythonRunner.runScript('report_generator.py', [
      '--type',
      reportType,
      '--data',
      JSON.stringify(data)
    ]);
  }
}

// Default instance
export const businessLogicService = new BusinessLogicService();
