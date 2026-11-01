"""Development only: export pgmpy reference distributions for explicit CPTs."""
import json
from pathlib import Path
import pgmpy, numpy, pandas
from pgmpy.models import DiscreteBayesianNetwork
from pgmpy.factors.discrete import TabularCPD
from pgmpy.inference import VariableElimination
variables=[{'id':'A','states':['a0','a1']},{'id':'B','states':['b0','b1','b2']},{'id':'C','states':['c0','c1','c2']}]
cpts=[{'variableId':'A','parentIds':[],'values':[.6,.4]}, {'variableId':'B','parentIds':[],'values':[.2,.5,.3]}, {'variableId':'C','parentIds':['A','B'],'values':[.7,.2,.1, .1,.6,.3, .2,.2,.6, .3,.4,.3, .1,.2,.7, .6,.3,.1]}]
bn=DiscreteBayesianNetwork([('A','C'),('B','C')])
for c in cpts:
    r=next(len(v['states']) for v in variables if v['id']==c['variableId'])
    parents=c['parentIds']; cards=[next(len(v['states']) for v in variables if v['id']==p) for p in parents]
    args={'evidence':parents,'evidence_card':cards} if parents else {}
    bn.add_cpds(TabularCPD(c['variableId'],r,numpy.array(c['values']).reshape(-1,r).T,**args))
assert bn.check_model()
infer=VariableElimination(bn)
cases=[]
for evidence in [{},{'A':1},{'C':2},{'A':0,'C':1}]:
    expected={}
    for v in variables:
        if v['id'] in evidence:
            expected[v['id']]=[float(i==evidence[v['id']]) for i in range(len(v['states']))]
        else: expected[v['id']]=infer.query([v['id']],evidence=evidence,show_progress=False).values.tolist()
    cases.append({'evidence':evidence,'expected':expected})
out={'reference':{'commit':'a196531fdf3dbce9d53088ea2e07a230953caf6f','pgmpy':pgmpy.__version__,'numpy':numpy.__version__,'pandas':pandas.__version__},'model':{'variables':variables,'cpts':cpts},'cases':cases}
Path('fixtures/reference.json').write_text(json.dumps(out,indent=2)+'\n')
