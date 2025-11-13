from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Literal
import plotly.graph_objects as go
import io
import sys
import os
import pandas as pd

# Add parent directory to path to import state
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from state import provenance_manager

router = APIRouter()


class VisualizationRequest(BaseModel):
    row_indices: List[int]
    column_indices: List[int]
    chart_type: Literal["parallel", "line"]


def create_parallel_coordinates(df_subset, columns):
    """Create a parallel coordinates plot using Plotly."""
    # Filter to numeric columns only
    numeric_cols = []
    for col in columns:
        if col in df_subset.columns:
            if pd.api.types.is_numeric_dtype(df_subset[col]):
                numeric_cols.append(col)
    
    if not numeric_cols:
        return None
    
    # Create dimensions for parallel coordinates
    dimensions = []
    for col in numeric_cols[:8]:  # Limit to 8 axes for readability
        col_data = df_subset[col].dropna()
        if len(col_data) > 0:
            dimensions.append(dict(
                range=[col_data.min(), col_data.max()],
                label=col,
                values=df_subset[col].fillna(0).tolist()
            ))
    
    if not dimensions:
        return None
    
    fig = go.Figure(data=go.Parcoords(
        line=dict(
            color=list(range(len(df_subset))),
            colorscale='Viridis',
            showscale=False
        ),
        dimensions=dimensions,
        labelangle=-30,
        labelside='top'
    ))
    
    fig.update_layout(
        paper_bgcolor='rgba(15, 23, 42, 0.95)',
        plot_bgcolor='rgba(15, 23, 42, 0.95)',
        font=dict(color='white', size=14),
        margin=dict(l=80, r=80, t=60, b=40),
        title=dict(
            text=f'{len(df_subset)} rows × {len(numeric_cols)} columns',
            font=dict(color='white', size=16),
            x=0.5,
            y=0.98
        )
    )
    
    return fig


def create_line_chart(df_subset, columns):
    """Create a line chart using Plotly."""
    # Filter to numeric columns only
    numeric_cols = []
    for col in columns:
        if col in df_subset.columns:
            if pd.api.types.is_numeric_dtype(df_subset[col]):
                numeric_cols.append(col)
    
    if not numeric_cols:
        return None
    
    # Limit to first 6 series for clarity
    cols_to_plot = numeric_cols[:6]
    
    fig = go.Figure()
    
    colors = ['#4F46E5', '#14B8A6', '#F97316', '#EC4899', '#22D3EE', '#84CC16']
    
    x_values = list(range(len(df_subset)))
    
    for i, col in enumerate(cols_to_plot):
        fig.add_trace(go.Scatter(
            x=x_values,
            y=df_subset[col].fillna(0).tolist(),
            mode='lines',
            name=col,
            line=dict(color=colors[i % len(colors)], width=2)
        ))
    
    fig.update_layout(
        paper_bgcolor='rgba(15, 23, 42, 0.95)',
        plot_bgcolor='rgba(15, 23, 42, 0.95)',
        font=dict(color='white', size=12),
        margin=dict(l=60, r=40, t=60, b=50),
        title=dict(
            text=f'{len(df_subset)} rows × {len(cols_to_plot)} series',
            font=dict(color='white', size=16),
            x=0.5,
            y=0.98
        ),
        xaxis=dict(
            title='Row Index',
            gridcolor='rgba(255,255,255,0.1)',
            zerolinecolor='rgba(255,255,255,0.2)'
        ),
        yaxis=dict(
            title='Value',
            gridcolor='rgba(255,255,255,0.1)',
            zerolinecolor='rgba(255,255,255,0.2)'
        ),
        legend=dict(
            orientation='h',
            yanchor='bottom',
            y=1.02,
            xanchor='center',
            x=0.5,
            font=dict(size=11)
        ),
        showlegend=True
    )
    
    return fig


@router.post("/visualization")
async def generate_visualization(request: VisualizationRequest):
    """
    Generate a static visualization image for the selected subtable.
    
    Args:
        request: Contains row_indices, column_indices, and chart_type
    
    Returns:
        PNG image as bytes
    """
    try:
        df = provenance_manager.get_current_df()
        
        # Validate indices
        valid_row_indices = [i for i in request.row_indices if 0 <= i < len(df)]
        all_columns = list(df.columns)
        valid_col_indices = [i for i in request.column_indices if 0 <= i < len(all_columns)]
        
        if not valid_row_indices or not valid_col_indices:
            raise HTTPException(status_code=400, detail="Invalid row or column indices")
        
        # Extract subtable
        selected_columns = [all_columns[i] for i in valid_col_indices]
        df_subset = df.iloc[valid_row_indices][selected_columns].copy()
        
        # Generate visualization
        if request.chart_type == "parallel":
            fig = create_parallel_coordinates(df_subset, selected_columns)
        else:  # line
            fig = create_line_chart(df_subset, selected_columns)
        
        if fig is None:
            raise HTTPException(status_code=400, detail="Could not generate visualization - no numeric columns found")
        
        # Export to PNG bytes
        # Use kaleido for image export
        img_bytes = fig.to_image(format="png", width=1024, height=512, scale=2)
        
        return Response(
            content=img_bytes,
            media_type="image/png",
            headers={
                "Cache-Control": "no-cache",
                "Content-Disposition": "inline"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Visualization error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/visualization/columns")
async def get_columns():
    """Get the list of columns in the current dataframe."""
    df = provenance_manager.get_current_df()
    return {"columns": list(df.columns), "row_count": len(df)}
