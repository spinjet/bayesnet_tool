"""Model training and inference abstraction over pgmpy.

Encapsulates the creation and fitting of a DiscreteBayesianNetwork, the
application of uniform priors, and exposes a simple query interface.
"""

from typing import Any, Dict, List


class BayesianNetworkModel:
    def __init__(self, edges: List[tuple]):
        self.edges = edges
        self.model = None
        self.infer = None

    def fit(self, df: Any, estimator: Any = None, **kwargs) -> None:
        """Fit the underlying pgmpy model to the provided dataframe.

        If ``estimator`` is omitted the default MaximumLikelihoodEstimator will
        be used.  Any additional keyword arguments are forwarded to the
        ``fit`` method of the pgmpy model.
        """
        from pgmpy.models import DiscreteBayesianNetwork
        from pgmpy.estimators import MaximumLikelihoodEstimator
        from pgmpy.inference import VariableElimination

        model = DiscreteBayesianNetwork(self.edges)
        if estimator is None:
            estimator = MaximumLikelihoodEstimator

        model.fit(df, estimator=estimator, **kwargs)
        self.model = model
        self.infer = VariableElimination(model)

    def apply_uniform_priors(self, node_config: Dict[str, Any]) -> None:
        """Override CPDs on nodes marked for uniform prior.

        This method assumes ``fit`` has already been called.
        """
        if self.model is None:
            raise RuntimeError("Model must be fitted before applying priors")

        import numpy as np

        for node in self.model.nodes():
            cfg = node_config.get(node, {})
            if cfg.get("uniform_prior", False):
                cpd = self.model.get_cpds(node)
                if cpd is not None:
                    card = cpd.variable_card
                    p = 1.0 / card
                    cpd.values = np.full_like(cpd.values, p)
                    cpd.normalize()
                    self.model.add_cpds(cpd)

    def query(self, variables: List[str], evidence: Dict[str, Any] = None) -> Any:
        """Perform inference and return the resulting factor object.

        The return value is whatever pgmpy.Inference.query returns, typically a
        ``DiscreteFactor`` or a dict of factors when querying multiple
        variables.
        """
        if self.infer is None:
            raise RuntimeError("Model has not been trained/inference engine missing")
        return self.infer.query(variables, evidence=evidence if evidence else None)
