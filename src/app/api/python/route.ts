import { NextRequest, NextResponse } from 'next/server';
import { businessLogicService } from '@/services/business-logic';
import { pythonRunner } from '@/lib/python-runner';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('Received request body:', body);
    const { action, data, script, code } = body;
    console.log('Parsed action:', action, 'data:', data);

    let result;

    switch (action) {
      case 'analyze_sales':
        result = await businessLogicService.analyzeSalesData(data);
        break;

      case 'predict':
        result = await businessLogicService.generatePrediction(data);
        break;

      case 'process_data':
        result = await businessLogicService.processData(data);
        break;

      case 'financial_metrics':
        result = await businessLogicService.calculateFinancialMetrics(data);
        break;

      case 'generate_report':
        result = await businessLogicService.generateReport(
          data.type,
          data.data
        );
        break;

      case 'run_script':
        console.log('Running script:', script, 'with args:', data?.args || []);
        if (script === 'orders.py') {
          result = await pythonRunner.runScript(script, data?.args || []);
        } else {
          result = await pythonRunner.runScript(script, data?.args || []);
        }
        console.log('Script result:', result);
        break;

      case 'cancel_order':
        console.log('Canceling order:', data.orderId);
        try {
          result = await pythonRunner.runScript('cancel_order.py', [
            '--orderId',
            data.orderId
          ]);
          console.log('Cancel result:', result);
        } catch (error) {
          console.error('Cancel order error:', error);
          result = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            executionTime: 0
          };
        }
        break;

      case 'run_code':
        result = await businessLogicService.runCustomAnalysis(code, data);
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid action specified' },
          { status: 400 }
        );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Python API error:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const script = searchParams.get('script');
  const args = searchParams.get('args')?.split(',') || [];

  if (!script) {
    return NextResponse.json(
      { error: 'Script parameter is required' },
      { status: 400 }
    );
  }

  try {
    const result = await pythonRunner.runScript(script, args);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Python script error:', error);
    return NextResponse.json(
      { error: 'Script execution failed' },
      { status: 500 }
    );
  }
}
