'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';

interface PythonResult {
  success: boolean;
  data?: any;
  error?: string;
  executionTime: number;
}

export function PythonTest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PythonResult | null>(null);
  const [testData, setTestData] = useState(`[
  {"product": "Laptop", "amount": 1200, "date": "2024-01-15"},
  {"product": "Mouse", "amount": 50, "date": "2024-01-16"},
  {"product": "Keyboard", "amount": 100, "date": "2024-01-17"},
  {"product": "Laptop", "amount": 1200, "date": "2024-02-01"},
  {"product": "Monitor", "amount": 300, "date": "2024-02-02"}
]`);

  const runPythonTest = async (action: string, data?: any) => {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/python', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action,
          data: data || JSON.parse(testData)
        })
      });

      const result = await response.json();
      setResult(result);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: 0
      });
    } finally {
      setLoading(false);
    }
  };

  const runCustomCode = async () => {
    setLoading(true);
    setResult(null);

    const customCode = `
import json
import sys

# Simple calculation
data = json.loads(sys.argv[1]) if len(sys.argv) > 1 else []
total = sum(item.get('amount', 0) for item in data)
count = len(data)
average = total / count if count > 0 else 0

result = {
    "total": total,
    "count": count,
    "average": round(average, 2),
    "message": f"Processed {count} records"
}

print(json.dumps(result))
`;

    try {
      const response = await fetch('/api/python', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'run_code',
          code: customCode,
          data: JSON.parse(testData)
        })
      });

      const result = await response.json();
      setResult(result);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: 0
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>Python Integration Test</CardTitle>
          <CardDescription>
            Test the Python script integration with your Next.js app
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='test-data'>Test Data (JSON)</Label>
            <Textarea
              id='test-data'
              value={testData}
              onChange={(e) => setTestData(e.target.value)}
              placeholder='Enter JSON test data...'
              rows={6}
            />
          </div>

          <div className='flex flex-wrap gap-2'>
            <Button
              onClick={() => runPythonTest('analyze_sales')}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : null}
              Analyze Sales
            </Button>

            <Button
              onClick={() =>
                runPythonTest('predict', {
                  historical_sales: [1000, 1200, 1100, 1300, 1400],
                  seasonality: 1.1
                })
              }
              disabled={loading}
            >
              {loading ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : null}
              Make Prediction
            </Button>

            <Button
              onClick={() => runPythonTest('process_data')}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : null}
              Process Data
            </Button>

            <Button
              onClick={runCustomCode}
              disabled={loading}
              variant='outline'
            >
              {loading ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : null}
              Run Custom Code
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              Result
              <Badge variant={result.success ? 'default' : 'destructive'}>
                {result.success ? 'Success' : 'Error'}
              </Badge>
              <Badge variant='outline'>{result.executionTime}ms</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.error ? (
              <Alert variant='destructive'>
                <AlertDescription>{result.error}</AlertDescription>
              </Alert>
            ) : (
              <div className='space-y-4'>
                <div>
                  <Label className='text-sm font-medium'>Data:</Label>
                  <pre className='bg-muted mt-2 max-h-96 overflow-auto rounded-md p-4 text-sm'>
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
